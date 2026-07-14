import { Logger } from 'pino';

// ── Message Types ──────────────────────────────────────────────

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  type: MessageType;
  timestamp: Date;
  fromMe: boolean;
  metadata?: Record<string, unknown>;
}

export type MessageType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'sticker' | 'location' | 'contact' | 'button' | 'template' | 'unknown';

export interface SendMessageOptions {
  content: string;
  to: string;
  type?: MessageType;
  metadata?: Record<string, unknown>;
}

// ── Contact Types ──────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  pushName?: string;
  number: string;
  isGroup: boolean;
  avatar?: string;
  lastSeen?: Date;
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
  notes?: string;
}

// ── Conversation / Chat Types ──────────────────────────────────

export interface Chat {
  id: string;
  contactId: string;
  contactName: string;
  lastMessage?: string;
  lastMessageAt?: Date;
  unreadCount: number;
  isGroup: boolean;
  createdAt: Date;
}

// ── Config Types ───────────────────────────────────────────────

export interface WAgentConfig {
  // WhatsApp
  whatsappSessionName: string;
  whatsappSessionDir?: string;
  whatsappNumbers?: WhatsAppNumberConfig[];

  // AI Provider
  aiProvider: AIProviderType;
  systemPrompt: string;

  // Provider-specific config
  openai?: {
    apiKey: string;
    model: string;
  };
  gemini?: {
    apiKey: string;
    model: string;
  };
  anthropic?: {
    apiKey: string;
    model: string;
  };
  ollama?: {
    baseUrl: string;
    model: string;
  };

  // Embedding Configuration
  embedding?: {
    /** Embedding model name (e.g. 'text-embedding-004', 'text-embedding-3-large', 'bge-large-en-v1.5') */
    model: string;
    /** Override dimensions (optional, uses model default if not set) */
    dimensions?: number;
  };

  // Auto-resolved model info from models.dev
  resolvedModel?: {
    input: string;
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    npm?: string;
    envKey?: string;
    name?: string;
  };

  // Conversation Settings
  /** Auto-send welcome message on new conversations */
  welcomeMessage?: string;
  /** Enable welcome message for new chats */
  welcomeMessageEnabled?: boolean;
  /** Hours of inactivity before conversation history is auto-cleaned (0 = disable) */
  conversationTimeoutHours?: number;

  // Rate Limiting
  /** Max messages per contact within the rate limit window */
  rateLimitMax?: number;
  /** Rate limit window in seconds */
  rateLimitWindowSeconds?: number;
  /** Message to send when rate limited */
  rateLimitMessage?: string;

  // Working Hours
  /** Working hours start (HH:mm format, 24h) */
  workingHoursStart?: string;
  /** Working hours end (HH:mm format, 24h) */
  workingHoursEnd?: string;
  /** Timezone for working hours (e.g. Asia/Jakarta) */
  workingHoursTimezone?: string;
  /** Message to send when outside working hours */
  offlineMessage?: string;
  /** Enable working hours */
  workingHoursEnabled?: boolean;

  // Escalation to Human (Telegram)
  /** Telegram Bot Token from @BotFather */
  telegramBotToken?: string;
  /** Telegram Chat ID of the group/channel */
  telegramChatId?: string;

  // Human Takeover
  /** Cooldown in minutes after a human reply during which AI won't respond */
  humanTakeoverCooldownMinutes?: number;

  // Group Chat
  /** Allow processing messages from groups */
  groupChatEnabled?: boolean;
  /** Only reply in groups when bot is @mentioned */
  groupChatReplyIfMentioned?: boolean;

  // Dashboard
  dashboardPort: number;
  dashboardHost: string;

  // Database
  databaseType: 'sqlite' | 'postgres';
  databaseUrl: string;

  // Knowledge Base
  knowledgeDir?: string;
  knowledgeBase?: {
    maxResults: number;
    minScore: number;
    enabled: boolean;
  };

  // HTTP (for HTTPClient/WebScraper)
  http?: {
    allowedDomains: string[];
  };
}



export type AIProviderType = 'openai' | 'gemini' | 'claude' | 'ollama';

// ── Transcription Types ────────────────────────────────────────

export type TranscriptionProvider = 'openai' | 'gemini' | 'none';

export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
  provider: TranscriptionProvider;
}

export interface AudioMessageData {
  buffer: Buffer;
  mimetype: string;
  duration?: number;
  fileSize?: number;
}

// ── AI Types ───────────────────────────────────────────────────

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface AIResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
  logger: Logger;
  db: import('./storage.js').Database;
  config: WAgentConfig;
  contactId: string;
  knowledgeStore?: import('./knowledge-store.js').KnowledgeStore;
}

// ── Skill / Plugin Types ───────────────────────────────────────

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  /** System prompt addition to append when this skill is active */
  systemPromptAdditions?: string;
}

export interface SkillDefinition {
  manifest: SkillManifest;
  tools: ToolDefinition[];
}

export type SkillFactory = () => SkillDefinition | Promise<SkillDefinition>;

// ── Event Types ────────────────────────────────────────────────

// ── Scheduled Message Types ────────────────────────────────────

export type ScheduledMessageStatus = 'pending' | 'active' | 'sent' | 'failed' | 'cancelled';
export type ScheduleRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

export interface ScheduledMessage {
  id: string;
  contactId: string;
  contactName: string;
  content: string;
  scheduledAt: Date;
  repeat: ScheduleRepeat;
  status: ScheduledMessageStatus;
  lastSentAt?: Date;
  nextRunAt?: Date;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledMessageInput {
  contactId: string;
  contactName: string;
  content: string;
  scheduledAt: Date;
  repeat?: ScheduleRepeat;
}

// ── Knowledge Base Types ─────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  tags: string[];
  priority: number;
  /** Embedding vector (768-dim float array from Gemini text-embedding-004), stored as JSON */
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSearchResult {
  entry: KnowledgeEntry;
  score: number;
  matchedOn: 'keyword' | 'question' | 'answer' | 'semantic';
}

export interface KnowledgeBaseConfig {
  /** Max results returned per search */
  maxResults: number;
  /** Minimum score threshold (0-1) */
  minScore: number;
  /** Enable knowledge base */
  enabled: boolean;
}

// ── Event Types ────────────────────────────────────────────────

export type GatewayEvent =
  | { type: 'message:received'; message: Message }
  | { type: 'message:sent'; message: Message }
  | { type: 'connection:update'; status: ConnectionStatus }
  | { type: 'qr:received'; qr: string }
  | { type: 'contact:update'; contact: Contact }
  | { type: 'chat:update'; chat: Chat }
  | { type: 'scheduled:update'; scheduled: ScheduledMessage }
  | { type: 'scheduled:deleted'; id: string }
  | { type: 'scheduled:list'; scheduled: ScheduledMessage[] }
  | { type: 'human:active'; chatId: string }
  | { type: 'human:inactive'; chatId: string }
  | { type: 'error'; error: Error }
  | { type: 'approval:request'; request: ApprovalRequest }
  | { type: 'approval:update'; request: ApprovalRequest }
  | { type: 'proactive:triggered'; action: ProactiveAction }
  | { type: 'broadcast:progress'; id: string; sent: number; failed: number; total: number }
  | { type: 'broadcast:completed'; id: string; sent: number; failed: number; total: number }
  | { type: 'broadcast:paused'; id: string }
  | { type: 'csat:send'; surveyId: string; contactId: string; message: string }
  | { type: 'csat:answered'; surveyId: string; contactId: string; rating: number; feedback?: string }
  | { type: 'workflow:send'; runId: string; contactId: string; message: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'qr';
export type GatewayEventHandler = (event: GatewayEvent) => void;

// ── Stats / Analytics Types ────────────────────────────────────

export interface DailyStats {
  date: string;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
  uniqueContacts: number;
  aiResponseCount: number;
  averageResponseTime: number;
}

export interface BroadcastMessage {
  id: string;
  content: string;
  targetFilter?: BroadcastFilter;
  status: 'pending' | 'sending' | 'completed' | 'failed' | 'cancelled';
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
  completedAt?: Date;
}

export interface BroadcastFilter {
  tags?: string[];
  lastActiveBefore?: Date;
  lastActiveAfter?: Date;
  groups?: boolean;
  individual?: boolean;
}

export interface BroadcastRecipient {
  broadcastId: string;
  contactId: string;
  status: 'pending' | 'sent' | 'failed' | 'delivered' | 'read';
  error?: string;
  sentAt?: Date;
}

// ── Multi-Number Types ────────────────────────────────────────

export interface WhatsAppNumberConfig {
  id: string;
  sessionName: string;
  label?: string;
  enabled: boolean;
}

export interface WhatsAppNumberInfo {
  id: string;
  sessionName: string;
  label: string;
  status: ConnectionStatus;
  userJid?: string;
  qrCode?: string;
}

// ── v2 Memory & Profile Types ──────────────────────────────────────

/**
 * Memory entry for short-term (JSONL) and long-term (Markdown) storage.
 */
export interface MemoryEntry {
  /** Contact/context identifier */
  contactId: string;
  /** Who said it */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Metadata (token count, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Per-contact communication style profile (stored as Markdown).
 */
export interface ContactProfile {
  /** JID or contact ID */
  contactId: string;
  /** Contact display name */
  name: string;
  /** Relationship type (teman, bos, customer, family, etc.) */
  relationship?: string;
  /** Communication tone (casual, formal, professional, friendly) */
  tone: 'casual' | 'formal' | 'professional' | 'friendly' | 'mixed';
  /** Language style description */
  language?: string;
  /** Preferred greetings */
  greetings?: string[];
  /** Emoji usage (rare, moderate, frequent) */
  emojiUsage?: 'rare' | 'moderate' | 'frequent';
  /** Example responses for style reference */
  exampleResponses?: string[];
  /** Topics of interest */
  topics?: string[];
  /** Notes for the agent */
  notes?: string;
  /** Recent interactions, e.g. "2026-07-13: Tanya kabar, ajak nongkrong" */
  recentInteractions?: string[];
  /** Auto-learned communication patterns */
  learnedPatterns?: string[];
  /** Last updated */
  updatedAt: Date;
}

/**
 * Configuration for building dynamic context.
 */
export interface ContextConfig {
  /** Base system prompt from config */
  baseSystemPrompt: string;
  /** Contact profile (may be null if not set up) */
  profile?: ContactProfile | null;
  /** Skill/framework additions */
  systemPromptAdditions?: string[];
  /** Conversation history context */
  conversationSummary?: string;
  /** Recent messages for context */
  recentMessages?: MemoryEntry[];
  /** Sender information */
  contactName?: string;
  /** Whether this is a new conversation */
  isNewConversation?: boolean;
}

/**
 * Result from StyleRouter — instructions for the Agent on style.
 */
export interface StyleDirective {
  /** Tone to use */
  tone: string;
  /** Language/style instructions */
  styleInstructions: string;
  /** Example response patterns */
  examples: string[];
}

// ── v2 Approval Queue Types ──────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type ApprovalSource = 'agent' | 'system' | 'manual';
export type ApprovalActionType =
  | 'send_message'
  | 'send_image'
  | 'create_order'
  | 'execute_tool'
  | 'proactive_action'
  | 'custom';

export interface ApprovalRequest {
  id: string;
  type: ApprovalActionType;
  title: string;
  description: string;
  status: ApprovalStatus;
  source: ApprovalSource;
  contactId?: string;
  contactName?: string;
  action: {
    toolName: string;
    args: Record<string, unknown>;
  };
  context: {
    conversationContext?: string;
    reason: string;
    aiReasoning?: string;
  };
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: 'telegram' | 'dashboard' | 'system' | 'auto_expire';
  resolutionNote?: string;
}

// ── v2 Proactive Action Types ──────────────────────────────────────

export type ProactiveTriggerType = 'time' | 'event' | 'pattern';
export type ProactiveActionType = 'reminder' | 'follow_up' | 'check_in' | 'broadcast' | 'custom';

export interface ProactiveTrigger {
  id: string;
  type: ProactiveTriggerType;
  /** For time-based: cron-like schedule or ISO datetime */
  schedule?: string;
  /** For event-based: event type to listen for */
  event?: string;
  /** For pattern-based: condition description */
  condition?: string;
  /** Contact to target (optional, for individual actions) */
  contactId?: string;
  contactName?: string;
}

export interface ProactiveAction {
  id: string;
  trigger: ProactiveTrigger;
  actionType: ProactiveActionType;
  title: string;
  description: string;
  /** Instructions for the agent when executing this action */
  prompt: string;
  priority: number;
  requiresApproval: boolean;
  /** Only fire during these hours (HH:mm format) */
  windowStart?: string;
  windowEnd?: string;
  /** Don't re-trigger within this many minutes */
  cooldownMinutes?: number;
  enabled: boolean;
  lastTriggeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── v2 Tool Sandbox Types ──────────────────────────────────────────

export interface ToolSandboxConfig {
  allowedCommands: string[];
  deniedCommands: string[];
  restrictedDirs: string[];
  timeoutMs: number;
  maxOutputLength: number;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  command: string;
}

// ── v2 Approval-requiring Tool Config ─────────────────────────────

export interface ToolApprovalConfig {
  toolName: string;
  requiresApproval: boolean;
  approvalTimeoutMinutes: number;
  autoApprove?: boolean;
  autoApproveThreshold?: number;
}

// ── Dashboard Event Types (WebSocket) ──────────────────────────

export type DashboardEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'chat:list'; chats: Chat[] }
  | { type: 'contact:list'; contacts: Contact[] }
  | { type: 'stats:update'; stats: DailyStats }
  | { type: 'connection:status'; status: ConnectionStatus }
  | { type: 'broadcast:update'; broadcast: BroadcastMessage }
  | { type: 'broadcast:recipient:update'; recipient: BroadcastRecipient }
  | { type: 'scheduled:update'; scheduled: ScheduledMessage }
  | { type: 'scheduled:deleted'; id: string }
  | { type: 'scheduled:list'; scheduled: ScheduledMessage[] };
