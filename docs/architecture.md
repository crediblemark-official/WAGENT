# 🏛️ Architecture — WAGENT

Dokumentasi arsitektur sistem, component relationships, data flow, dan design decisions.

---

## 📐 System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        wagent CLI                                 │
│  (commander.js)                                                   │
│  ┌─────┐ ┌──────┐ ┌────┐ ┌──────┐ ┌──────────┐ ┌───────┐       │
│  │init │ │start │ │kb  │ │crypto│ │escalation│ │skill  │ ...     │
│  │wizard│ │gate. │ │ mgt│ │ mgt  │ │  test    │ │ mgt   │       │
│  └──┬──┘ └──┬───┘ └──┬─┘ └──┬───┘ └────┬─────┘ └───┬───┘       │
└─────┼───────┼────────┼──────┼──────────┼───────────┼───────────┘
      │       │        │      │          │           │
      ▼       ▼        ▼      ▼          ▼           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    @wagent/core (Engine)                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                      Gateway                                  │ │
│  │  • Event loop: whatsapp → handleIncomingMessage               │ │
│  │  • Human takeover detection                                   │ │
│  │  • Rate limiting (per-contact sliding window)                 │ │
│  │  • Working hours check (timezone-aware)                       │ │
│  │  • Group chat filter (@mention)                               │ │
│  │  • Natural delay simulation (read + typing)                   │ │
│  │  • Scheduler integration                                      │ │
│  │  • Escalation triggers                                        │ │
│  └──────────┬───────────────────────────────────────────────────┘ │
│             │                                                     │
│  ┌──────────▼───────────────────────────────────────────────────┐ │
│  │                      Agent                                    │ │
│  │  • AI Provider abstraction (OpenAI / Gemini / Claude / Ollama)│ │
  │  │  • Tool execution loop (max 10 iterations)                   │ │
  │  │  • Conversation history management                            │ │
  │  │  • Built-in tools (12):                                       │ │
  │  │    - get_customer_info                                        │ │
  │  │    - get_conversation_history                                 │ │
  │  │    - get_current_time                                         │ │
  │  │    - add_note                                                  │ │
  │  │    - get_customer_tags                                        │ │
  │  │    - search_knowledge_base (semantic + keyword fallback)      │ │
  │  │    - escalate_to_human                                        │ │
  │  │    - lookup_order (cek status order dari DB)                  │ │
  │  │    - check_stock (cek stok real-time dari DB)                 │ │
  │  │    - send_message (kirim pesan ke kontak)                     │ │
  │  │    - send_image (kirim gambar)                                │ │
  │  │    - create_reminder (reminder via cron)                      │ │
│  │  • User-provided tools from Skills                            │ │
│  └──────────┬───────────────────────────────────────────────────┘ │
│             │                                                     │
│  ┌──────────▼───────────────────────────────────────────────────┐ │
│  │                   Database (SQLite)                           │ │
│  │  • Contacts, Chats, Messages                                  │ │
│  │  • Conversations (AI context history)                         │ │
│  │  • Knowledge Base (with embedding storage)                    │ │
│  │  • Broadcasts & Recipients                                    │ │
│  │  • Scheduled Messages                                         │ │
│  │  • Daily Stats                                                │ │
│  │  • WAL mode + foreign keys + auto-encrypt on close            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │  Scheduler   │ │  Transcriber │ │   EmbeddingService       │  │
│  │  (msg cron)  │ │ (voice→text) │ │   (Gemini embeddings)    │  │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │  Escalation  │ │  EventBus    │ │     Crypto               │  │
│  │ (Telegram)   │ │  (pub/sub)   │ │   (AES-256-GCM)          │  │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐                               │
│  │  SkillLoader │ │ Logger (Pino)│                               │
│  └──────────────┘ └──────────────┘                               │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    WhatsApp Adapter                               │
│  • WhatsAppAdapter interface                                      │
│  • BaileysAdapter (via @wagent/whatsapp)                         │
│  • MultiWhatsAppAdapter (composite for multi-number)             │
│  • JID routing table (JID → numberId)                            │
│  • sendPresenceUpdate, readMessages, downloadAudio               │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│         WhatsApp Network (via @whiskeysockets/baileys)           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Component Detail

### Gateway (`gateway.ts`)

**Role:** Message routing & orchestration hub. Entry point untuk semua pesan WhatsApp.

**Key responsibilities:**
- Listen untuk event dari WhatsApp adapter
- Detect human takeover (`fromMe` messages not in DB)
- Rate limit checking (sliding window per contact)
- Working hours validation (timezone-aware)
- Group chat filtering (`@mention` check)
- Audio transcription via Transcriber
- Natural delay simulation (reading + typing)
- Schedule welcome messages for new contacts
- Mark messages as read (blue check ✓✓)
- Show typing indicator (composing presence)
- Trigger escalation on AI errors / empty responses
- Stale conversation cleanup

**Lifecycle:**

```
Gateway Constructor
  → Create EventBus, Agent, Scheduler, Transcriber, EscalationService
  → Register whatsapp.onEvent(handleWhatsAppEvent)
  → Register dashboard broadcast on EventBus

Gateway.start()
  → whatsapp.connect()
  → Start stale conversation cleanup (interval 30min)
  → Start rate limit cleanup (interval 60s)
  → Start working hours presence check (interval 5min)
  → Set online presence after 2s
  → dashboard.start()
  → scheduler.start()

Gateway.stop()
  → Clear all intervals
  → Emit human:inactive for all active entries
  → dashboard.stop()
  → Set offline presence
  → whatsapp.disconnect()
  → Remove all event listeners
```

**Natural Delay Algorithm:**

```
calculateHumanDelay(message, msgId):
  wordCount = max(split(message).length, 1)
  hash = deterministicHash(msgId || message)
  base = 1000 + abs(hash % 2000)  // 1-3 seconds
  readingTime = wordCount * 200     // 200ms per word
  return min(base + readingTime, 8000)

calculateTypingDelay(response):
  chars = response.length
  speed = chars < 50 → 120ms/char, < 200 → 80ms/char, else → 50ms/char
  return min(chars * speed, 15000)
```

### Agent (`agent.ts`)

**Role:** AI orchestration — mengelola percakapan dengan LLM, tool execution, dan conversation history.

**AI Provider Architecture:**

```
AIProvider (interface)
├── OpenAIProvider    → POST https://api.openai.com/v1/chat/completions
├── GeminiProvider    → POST .../v1beta/models/{model}:generateContent
├── ClaudeProvider    → POST https://api.anthropic.com/v1/messages
└── OllamaProvider    → POST {baseUrl}/api/chat
```

**Message Processing Flow:**

```
processMessage(content, contactId, contactName)

1. Get conversation history from DB (last 30 entries)
2. Build messages array: [system, ...history, user]
3. Save user message to conversation history
4. Enter tool execution loop (max 10 iterations):
   a. Call AI provider with messages + tools
   b. If toolCalls → execute each tool, push results, repeat
   c. If no toolCalls → final response, break
   d. On error → return apology, break
5. Save AI response to conversation history
6. Trim conversation if > 60 entries
7. Return response
```

**Built-in Tools (12):**

| Tool | Fungsi | Trigger |
|------|--------|---------|
| `get_customer_info` | Cari data customer by name/number | AI decides |
| `get_conversation_history` | Lihat riwayat chat | AI decides |
| `get_current_time` | Cek waktu sekarang (WIB) | AI decides |
| `add_note` | Tambah catatan ke customer | AI decides |
| `get_customer_tags` | Lihat tags customer | AI decides |
| `search_knowledge_base` | Cari FAQ (semantic + keyword) | AI decides |
| `escalate_to_human` | Minta bantuan CS via Telegram | AI decides |
| `lookup_order` | Cek status order dari DB | AI decides |
| `check_stock` | Cek stok real-time dari DB | AI decides |
| `send_message` | Kirim pesan ke kontak | AI decides |
| `send_image` | Kirim gambar ke kontak | AI decides |
| `create_reminder` | Reminder via cron | AI decides |

### Database (`storage.ts`)

**Role:** SQLite persistence layer dengan auto-encryption.

**Schema:**

```
contacts         → Customer data (name, number, tags, notes)
chats            → Chat summary (last message, unread count)
messages         → Individual messages
conversations    → AI context history (role, content)
daily_stats      → Message counts per day
broadcasts       → Broadcast campaigns
broadcast_recipients → Per-contact broadcast status
scheduled_messages  → Scheduled/recurring messages
knowledge_base   → FAQ entries + embeddings (RAG)
```

**Auto-Encryption:**

```
Constructor:
  1. Check if .db.encrypted exists + key available
     → Auto-decrypt to .db
  2. Open SQLite connection (WAL mode, foreign keys ON)
  3. Initialize tables and migrations

close():
  1. Close SQLite connection
  2. If encryption key available
     → Encrypt .db → .db.encrypted
     → Delete .db
```

### EmbeddingService (`embeddings.ts`)

**Role:** Generate vector embeddings for RAG semantic search.

```
generateEmbedding(text)
  → POST .../text-embedding-004:embedContent
  → Returns 768-dim float array or null

cosineSimilarity(a, b)
  → dotProduct / (normA * normB)
  → Returns -1 to 1

generateKbEmbedding(question, answer, keywords)
  → Combines text → generateEmbedding
```

### EventBus (`event-bus.ts`)

**Role:** Simple pub/sub for internal events.

```
GatewayEvent types:
  message:received    → New incoming message
  message:sent       → AI response sent
  connection:update   → WhatsApp connection status
  qr:received        → QR code for scan
  contact:update     → Contact data changed
  chat:update        → Chat summary changed
  human:active       → Human replied (takeover)
  human:inactive     → Human cooldown expired
  scheduled:update   → Scheduled message changed
  scheduled:deleted  → Scheduled message deleted
  scheduled:list     → All scheduled messages
  error              → Error event
```

**Wildcard handlers** (used by Dashboard to forward all events to WebSocket clients).

### EscalationService (`escalation.ts`)

**Role:** Send escalation notifications to Telegram group.

**Trigger conditions:**
1. AI error (provider error)
2. AI empty response (returned nothing)
3. AI explicitly can't answer (detected by keywords)
4. Tool explicitly calls `escalate_to_human`

**Deduplication:** 60-second cooldown per contact via `canEscalate()`.

### Scheduler (`scheduler.ts`)

**Role:** Send scheduled/recurring messages.

**Check interval:** 30 seconds  
**Repeat modes:** `none`, `daily`, `weekly`, `monthly`

### SkillLoader (`skill-loader.ts`)

**Role:** Plugin system for loading external skills.

**Skill format:** `.js` / `.mjs` file with default export function

```typescript
// Example skill
export default function mySkill(): SkillDefinition {
  return {
    manifest: { name: 'my-skill', version: '1.0.0', description: 'Custom skill' },
    tools: [
      { name: 'my_tool', description: 'Does something', parameters: {}, handler: async () => 'result' }
    ],
  };
}
```

### MultiWhatsAppAdapter (`multi-adapter.ts`)

**Role:** Composite adapter untuk multi-number WhatsApp.

**JID Routing Table:** `Map<JID, numberId>` — melacak nomor mana yang menerima pesan dari kontak tertentu, sehingga reply dikirim via nomor yang sama.

---

## 🔄 Data Flow: Incoming Message

```
WhatsApp Message Received
        │
        ▼
MultiWhatsAppAdapter.onEvent()
  → Enrich event with numberId
  → Register JID → numberId in routing table
  → Forward to Gateway
        │
        ▼
Gateway.handleWhatsAppEvent(event)
  → Emit to EventBus & Dashboard
  → Check: fromMe + not in DB?
    YES → Human takeover detected → save message → return
    NO  → handleIncomingMessage(msg)
        │
        ▼
Gateway.handleIncomingMessage(msg)
  1. Human active? → skip AI
  2. Group chat? → filter @mention
  3. Rate limit? → send rate message → return
  4. Working hours? → send offline message → return
  5. Save contact & chat to DB
  6. Audio message? → transcribe via Whisper/Gemini
  7. Save message to DB
  8. Auto-welcome for new chats
  9. Mark as read (blue check)
  10. Start typing indicator
  11. Natural pre-delay (reading time)
  12. Agent.processMessage(content, contactId, name)
        │
        ▼
Agent.processMessage()
  1. Get conversation history
  2. Build LLM messages array
  3. Call AI provider (loop max 10x for tool calls)
  4. Execute tools as needed
  5. Return final response
        │
        ▼
Gateway.handleIncomingMessage (continued)
  12. Stop typing indicator
  13. Natural post-delay (typing speed)
  14. Send response via WhatsApp
  15. Save response message to DB
  16. Update chat last message
  17. Emit message:sent event
  18. Check: AI can't answer? → escalate to Telegram
```

---

## 🗄️ Database Schema Detail

```sql
-- Contacts
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,         -- JID (e.g. 62812xxxx@s.whatsapp.net)
  name TEXT NOT NULL DEFAULT '',
  push_name TEXT,              -- Nama dari WhatsApp
  number TEXT NOT NULL,        -- Nomor telepon
  is_group INTEGER DEFAULT 0,
  avatar TEXT,
  last_seen TEXT,
  tags TEXT DEFAULT '[]',      -- JSON array
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Chats (conversation summaries)
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  contact_name TEXT DEFAULT '',
  last_message TEXT,
  last_message_at TEXT,
  unread_count INTEGER DEFAULT 0,
  is_group INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Messages
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  from_jid TEXT NOT NULL,
  to_jid TEXT NOT NULL,
  content TEXT DEFAULT '',
  message_type TEXT DEFAULT 'text',
  from_me INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL,
  metadata TEXT DEFAULT '{}'
);

-- AI Conversation Context
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  role TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Knowledge Base (RAG)
CREATE TABLE knowledge_base (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'general',
  question TEXT DEFAULT '',
  answer TEXT NOT NULL,
  keywords TEXT DEFAULT '[]',   -- JSON array
  tags TEXT DEFAULT '[]',       -- JSON array
  priority INTEGER DEFAULT 0,
  embedding TEXT,               -- JSON array of 768 floats (Gemini embedding)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Flexible RAG: uploaded files
CREATE TABLE kb_files (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing', -- processing, ready, partial, failed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Flexible RAG: file chunks with embeddings
CREATE TABLE kb_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES kb_files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  section_heading TEXT,
  row_number INTEGER,
  line_start INTEGER,
  line_end INTEGER,
  embedding TEXT,               -- JSON array of 768 floats
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 🛡️ Security Architecture

### Encryption at-rest (AES-256-GCM)

```
Data Flow:
  Write:
    plaintext → AES-256-GCM Encrypt → [iv(16)][tag(16)][encrypted] → .encrypted file
  Read:
    .encrypted file → Parse [iv][tag][encrypted] → AES-256-GCM Decrypt → plaintext
  
Key Management:
  OPENCE_ENCRYPTION_KEY = randomBytes(32).toString('hex')  → env variable
  
Auto-Decrypt on Startup:
  if .env.encrypted exists + key available → decrypt to .env
  if database.encrypted exists + key available → decrypt to database
  
Auto-Encrypt on Shutdown:
  if key available → encrypt database → database.encrypted → delete original
```

### What Gets Encrypted
- `.env` file → `.env.encrypted`
- Database file → `.db.encrypted`
- WhatsApp session files (.json, .bin)
- `numbers.json` config

---

## Decision Records

### Why SQLite (not Postgres)?
- **MVP focus:** Zero setup required, file-based
- **Embedded:** No separate server process
- **Performance:** WAL mode handles concurrent reads well
- **Portability:** Single file, easy backup
- **Trade-off:** Not suitable for >100K concurrent users

### Why BetterSQLite3 (not Sequelize/TypeORM)?
- **Synchronous API:** Predictable performance
- **Minimal overhead:** Direct SQL, no ORM magic
- **TypeScript-friendly:** Typed queries

### Why Gemini for Embeddings (not OpenAI)?
- **Free tier:** 60 embeddings/minute free
- **768 dimensions:** Good balance of precision & storage
- **Unified API:** Same Gemini key for AI + embeddings + transcription

### Why `fromMe` Detection for Human Takeover?
- **No setup required:** Human agent hanya perlu punya akses WhatsApp Web
- **Real-time:** Mendeteksi balasan langsung, tanpa polling
- **Reliable:** Message ID check prevents false positives

---

## 🚀 v2.0 Architecture (Implemented)

Lihat [PLAN.md](../PLAN.md) untuk detail lengkap.

### New Components

```
┌──────────────────────────────────────────────────────────────────┐
│                    @wagent/core (v2.0)                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Memory System ✅                           │ │
│  │  • Working Memory (Map<contactId, SessionMemory>)            │ │
│  │  • Short-term (JSONL daily files)                            │ │
│  │  • Long-term (Markdown files)                                │ │
│  │  • Facts extraction (auto from messages)                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Knowledge Store ✅                         │ │
│  │  • Flexible RAG (upload .md, .txt, .csv, .json)              │ │
│  │  • Auto-chunking (per section/paragraph/row)                 │ │
│  │  • Auto-embedding (Gemini text-embedding-004)                │ │
│  │  • Combined search (semantic 0.7 + keyword 0.3)              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Scheduler v2 ✅                            │ │
│  │  • One-time messages                                         │ │
│  │  • Recurring (daily/weekly/monthly)                          │ │
│  │  • Sequences (follow-up chains)                              │ │
│  │  • Trigger-based (no-reply, specific time)                   │ │
│  │  • Approval queue (Telegram approve/reject)                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Learning System ✅                         │ │
│  │  • Style learning (per-contact tone)                         │ │
│  │  • Pattern detection (recurring topics)                      │ │
│  │  • Correction detection ("bukan X, tapi Y")                  │ │
│  │  • Facts extraction (name, preferences, etc.)                │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    Tools (v2.0) ✅                            │ │
│  │  • lookup_order (cek status order dari DB)                   │ │
│  │  • check_stock (cek stok real-time dari DB)                  │ │
│  │  • send_message (kirim pesan ke kontak)                      │ │
│  │  • send_image (kirim gambar)                                 │ │
│  │  • create_reminder (reminder via cron)                       │ │
│  │  • Safe Shell (whitelisted commands)                         │ │
│  │  • HTTP Client (domain whitelist)                            │ │
│  │  • File Manager (sandboxed read/write)                       │ │
│  │  • Web Scraper (fetch + parse)                               │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Control Plane Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Control Plane                                  │
│                                                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Telegram Bot     │  │ WA Self-Chat    │  │ Web Dashboard    │  │
│  │ (Primary)        │  │ (Secondary)     │  │ (KB Manager)     │  │
│  │                  │  │                  │  │                  │  │
│  │ /status          │  │ /status          │  │ Upload files     │  │
│  │ /pause           │  │ /pause           │  │ View/search KB   │  │
│  │ /resume          │  │ /resume          │  │ Delete files     │  │
│  │ /approve <id>    │  │ /stats           │  │                  │  │
│  │ /reject <id>     │  │ /contacts        │  │                  │  │
│  │ /stats           │  │ /help            │  │                  │  │
│  │ /memory          │  │                  │  │                  │  │
│  │ /help            │  │                  │  │                  │  │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Memory System Flow

```
Incoming Message
        │
        ▼
┌─────────────────────────────────────┐
│ 1. Update Working Memory            │
│    (Map<contactId, SessionMemory>)  │
│    • lastTopic, mood, style         │
│    • pendingQuestions               │
│    • factsThisSession               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 2. Extract Facts (async)            │
│    • Name, phone, email             │
│    • Preferences, preferences       │
│    • Topics discussed               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 3. Check Corrections                │
│    "bukan X, tapi Y" → update facts │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 4. Style Learning                   │
│    • Detect tone from messages      │
│    • Update contact.styleProfile    │
│    • Apply style to next response   │
└─────────────────────────────────────┘
```

### Scheduled Messaging Flow

```
User: "Remind me to follow up with Budi in 3 days"
        │
        ▼
┌─────────────────────────────────────┐
│ 1. Parse Schedule Request           │
│    • type: one-time                 │
│    • datetime: 3 days from now      │
│    • recipient: Budi                │
│    • message: follow-up content     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 2. Add to Approval Queue            │
│    • status: pending                │
│    • sentTo: Telegram for approval  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 3. User Approves via Telegram       │
│    /approve <schedule-id>           │
│    → status: approved               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 4. Scheduler Executes               │
│    • Cron job checks every 30s      │
│    • Match: datetime + approved     │
│    • Send message via WhatsApp      │
│    • Log to daily memory            │
└─────────────────────────────────────┘
```

### Flexible RAG Flow

```
User: "Upload products.csv"
        │
        ▼
┌─────────────────────────────────────┐
│ 1. File Upload                      │
│    • Save to data/kb-files/         │
│    • Validate format (.csv)         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 2. Auto-Chunk                       │
│    • CSV: per row → text            │
│    • MD: per section (##)           │
│    • TXT: per paragraph             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 3. Auto-Embed                       │
│    • Gemini text-embedding-004      │
│    • Store in SQLite (768-dim)      │
│    • Link to source file            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 4. Searchable                       │
│    • Query → embed → cosine sim     │
│    • Return top-K results           │
│    • Source attribution             │
└─────────────────────────────────────┘
```
