import { Logger } from 'pino';
import {
  WAgentConfig,
  AIMessage,
  AIResponse,
  ToolDefinition,
  ToolContext,
  AIProviderType,
  MemoryEntry,
  ContactProfile,
} from './types.js';
import { Database } from './storage.js';
import { getLogger } from './logger.js';
import { createBuiltInTools } from './tools.js';
import { MemoryManager } from './memory-manager.js';
import { ContextBuilder } from './context-builder.js';
import { StyleRouter } from './style-router.js';
import { ApprovalQueue as ApprovalQueueImpl } from './approval-queue.js';
import { Summarizer } from './summarizer.js';
import { Learner, type LearningResult } from './learner.js';
import { KnowledgeStore } from './knowledge-store.js';

// ── AI Provider Interface ──────────────────────────────────────

interface AIProvider {
  chat(messages: AIMessage[], tools: ToolDefinition[]): Promise<AIResponse>;
  name: string;
}

// ── OpenAI Provider ─────────────────────────────────────────────

class OpenAIProvider implements AIProvider {
  name = 'OpenAI';

  constructor(private config: { apiKey: string; model: string }, private baseUrl = 'https://api.openai.com/v1') {}

  async chat(messages: AIMessage[], tools: ToolDefinition[]): Promise<AIResponse> {
    const cleanUrl = this.baseUrl.endsWith('/chat/completions') ? this.baseUrl : `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(cleanUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.role === 'tool' ? { tool_call_id: m.tool_call_id } : {}),
        })),
        tools: tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: 'auto',
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const choice = data.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      content: choice.message.content || '',
      toolCalls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }
}

// ── Google Gemini Provider ──────────────────────────────────────

class GeminiProvider implements AIProvider {
  name = 'Gemini';

  constructor(private config: { apiKey: string; model: string; baseUrl?: string }) {}

  async chat(messages: AIMessage[], tools: ToolDefinition[]): Promise<AIResponse> {
    const systemMsg = messages.find(m => m.role === 'system');
    const history = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: any = {
      contents: history,
      generationConfig: {
        maxOutputTokens: 4096,
      },
    };

    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg.content }],
      };
    }

    if (tools.length > 0) {
      body.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    const baseUrl = this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const endpoint = `${baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text || '';

    const toolCalls = candidate?.content?.parts
      ?.filter((p: any) => p.functionCall)
      ?.map((p: any) => ({
        id: p.functionCall.name,
        type: 'function' as const,
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args),
        },
      }));

    return {
      content,
      toolCalls,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0),
      } : undefined,
    };
  }
}

// ── Anthropic Claude Provider ───────────────────────────────────

class ClaudeProvider implements AIProvider {
  name = 'Claude';

  constructor(private config: { apiKey: string; model: string; baseUrl?: string }) {}

  async chat(messages: AIMessage[], tools: ToolDefinition[]): Promise<AIResponse> {
    const systemMsg = messages.find(m => m.role === 'system');

    const body: any = {
      model: this.config.model,
      max_tokens: 4096,
      messages: messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const endpoint = this.config.baseUrl || 'https://api.anthropic.com/v1/messages';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const content = data.content?.[0]?.text || '';
    const toolCalls = data.content
      ?.filter((c: any) => c.type === 'tool_use')
      ?.map((c: any) => ({
        id: c.id,
        type: 'function' as const,
        function: {
          name: c.name,
          arguments: JSON.stringify(c.input),
        },
      }));

    return {
      content,
      toolCalls,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      } : undefined,
    };
  }
}

// ── Ollama (local) Provider ─────────────────────────────────────

class OllamaProvider implements AIProvider {
  name = 'Ollama';

  constructor(private config: { baseUrl: string; model: string }) {}

  async chat(messages: AIMessage[], tools: ToolDefinition[]): Promise<AIResponse> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        tools: tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const toolCalls = data.message?.tool_calls?.map((tc: any) => ({
      id: tc.function.name,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: JSON.stringify(tc.function.arguments),
      },
    }));

    return {
      content: data.message?.content || '',
      toolCalls,
    };
  }
}

// ── Agent Class ─────────────────────────────────────────────────

export class Agent {
  private provider: AIProvider;
  private tools: ToolDefinition[];
  private logger: Logger;
  private maxToolIterations = 10;

  // v2 sub-components
  private memoryManager: MemoryManager;
  private contextBuilder: ContextBuilder;
  private styleRouter: StyleRouter;
  private approvalQueue?: ApprovalQueueImpl;
  private summarizer?: Summarizer;
  private learner?: Learner;
  private knowledgeStore?: KnowledgeStore;
  private _scheduler?: import('./scheduler.js').Scheduler;
  private _memoryEnabled: boolean;
  private _styleEnabled: boolean;
  private _autoSummarizeEnabled: boolean;
  private _autoLearnEnabled: boolean;
  /** Minimum conversation entries before auto-summary triggers */
  private _autoSummarizeThreshold = 20;
  /** Tool names that require human approval before execution */
  private approvalRequiredTools: Set<string> = new Set(['send_message', 'send_image', 'create_order']);

  constructor(
    private config: WAgentConfig,
    private db: Database,
    extraTools: ToolDefinition[] = [],
    options?: {
      memoryManager?: MemoryManager;
      contextBuilder?: ContextBuilder;
      styleRouter?: StyleRouter;
      approvalQueue?: ApprovalQueueImpl;
      summarizer?: Summarizer;
      learner?: Learner;
      knowledgeStore?: KnowledgeStore;
      scheduler?: import('./scheduler.js').Scheduler;
      memoryEnabled?: boolean;
      styleEnabled?: boolean;
      autoSummarizeEnabled?: boolean;
      autoSummarizeThreshold?: number;
      autoLearnEnabled?: boolean;
    }
  ) {
    this.logger = getLogger().child({ module: 'agent' });
    this.provider = this.createProvider(config);
    this.tools = [...createBuiltInTools(config), ...extraTools];

    // Initialize v2 sub-components (with defaults)
    this.memoryManager = options?.memoryManager || new MemoryManager();
    this.contextBuilder = options?.contextBuilder || new ContextBuilder();
    this.styleRouter = options?.styleRouter || new StyleRouter(this.memoryManager);
    this.approvalQueue = options?.approvalQueue;
    this.summarizer = options?.summarizer;
    this.learner = options?.learner;
    this.knowledgeStore = options?.knowledgeStore;
    this._scheduler = options?.scheduler;
    this._memoryEnabled = options?.memoryEnabled ?? true;
    this._styleEnabled = options?.styleEnabled ?? true;
    this._autoSummarizeEnabled = options?.autoSummarizeEnabled ?? true;
    this._autoSummarizeThreshold = options?.autoSummarizeThreshold ?? 20;
    this._autoLearnEnabled = options?.autoLearnEnabled ?? true;
  }

  private createProvider(config: WAgentConfig): AIProvider {
    const resolved = config.resolvedModel;
    if (!resolved) {
      throw new Error('AI Model belum dikonfigurasi dengan benar (resolvedModel missing).');
    }

    const providerName = resolved.name || resolved.provider;
    const apiKey = resolved.apiKey || '';
    const baseUrl = resolved.baseUrl || 'https://api.openai.com/v1';

    // Untuk provider spesifik yang memiliki SDK/endpoint khusus
    switch (resolved.provider) {
      case 'google':
      case 'gemini':
        if (!apiKey) throw new Error('Gemini API key not configured');
        return new GeminiProvider({ apiKey, model: resolved.model, baseUrl: resolved.baseUrl });
        
      case 'anthropic':
      case 'claude':
        if (!apiKey) throw new Error('Anthropic API key not configured');
        return new ClaudeProvider({ apiKey, model: resolved.model, baseUrl: resolved.baseUrl });
        
      case 'ollama':
        return new OllamaProvider({ baseUrl: resolved.baseUrl || 'http://localhost:11434/api', model: resolved.model });
        
      case 'openai':
      default:
        // Gunakan OpenAI-compatible endpoint untuk provider lainnya (deepseek, groq, xai, dll)
        const provider = new OpenAIProvider({ apiKey, model: resolved.model }, baseUrl);
        provider.name = providerName;
        return provider;
    }
  }

  // ── v2 Configuration ───────────────────────────────────────────

  getProviderName(): string {
    return this.provider.name;
  }

  getTools(): ToolDefinition[] {
    return this.tools;
  }

  /** Get the MemoryManager instance (for direct access). */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  /** Get the ContextBuilder instance. */
  getContextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }

  /** Get the StyleRouter instance. */
  getStyleRouter(): StyleRouter {
    return this.styleRouter;
  }

  /** Enable/disable memory features at runtime. */
  setMemoryEnabled(enabled: boolean): void {
    this._memoryEnabled = enabled;
  }

  /** Enable/disable style features at runtime. */
  setStyleEnabled(enabled: boolean): void {
    this._styleEnabled = enabled;
  }

  /**
   * Set which tools require human approval.
   */
  setApprovalRequiredTools(tools: string[]): void {
    this.approvalRequiredTools = new Set(tools);
  }

  /**
   * Enable/disable auto-summarization at runtime.
   */
  setAutoSummarizeEnabled(enabled: boolean): void {
    this._autoSummarizeEnabled = enabled;
  }

  /**
   * Check if auto-summarization is enabled.
   */
  isAutoSummarizeEnabled(): boolean {
    return this._autoSummarizeEnabled;
  }

  /**
   * Set the minimum conversation entries before auto-summary triggers.
   */
  setAutoSummarizeThreshold(threshold: number): void {
    this._autoSummarizeThreshold = threshold;
  }

  /**
   * Enable/disable auto-learning at runtime.
   */
  setAutoLearnEnabled(enabled: boolean): void {
    this._autoLearnEnabled = enabled;
  }

  /**
   * Check if auto-learning is enabled.
   */
  isAutoLearnEnabled(): boolean {
    return this._autoLearnEnabled;
  }

  /**
   * Add a tool to the approval-required list.
   */
  addApprovalRequiredTool(toolName: string): void {
    this.approvalRequiredTools.add(toolName);
  }

  /**
   * Check if a tool requires approval.
   */
  isToolApprovalRequired(toolName: string): boolean {
    return this.approvalRequiredTools.has(toolName);
  }

  /**
   * Set the scheduler for tool context (called after construction since scheduler is created later).
   */
  setScheduler(scheduler: import('./scheduler.js').Scheduler): void {
    this._scheduler = scheduler;
  }

  /**
   * Build the context for an incoming message.
   * Uses v2 sub-components when enabled, falls back to v1 behavior.
   */
  private async buildContext(
    messageContent: string,
    contactId: string,
    contactName: string,
  ): Promise<AIMessage[]> {
    // v1: Get conversation history from DB
    const history = this.db.getConversationHistory(contactId);

    // v2: Save to memory (JSONL) when enabled
    if (this._memoryEnabled) {
      this.memoryManager.appendMemory(contactId, 'user', messageContent, {
        contactName,
      });
    }

    // v2: Build enriched context when style/memory is enabled
    if (this._styleEnabled) {
      try {
        // Load or create contact profile
        const profile = await this.styleRouter.getOrCreateProfile(contactId, contactName);

        // Detect conversation context type (casual/urgent/business) — PLAN.md Step 4
        const contextType = this.styleRouter.detectContextType(contactId);

        // Get conversation summary from memory
        const conversationSummary = this._memoryEnabled
          ? this.memoryManager.loadConversationSummary(contactId)
          : null;

        // Get skill prompt additions
        const skillAdditions: string[] = [];
        // (Skills are loaded by the Gateway/SkillLoader — we just pass what we have)

        const isNewChat = history.length === 0;

        // Build context config with context-aware style
        const contextConfig = this.contextBuilder.createConfig({
          baseSystemPrompt: this.config.systemPrompt,
          profile,
          systemPromptAdditions: skillAdditions,
          conversationSummary,
          contactName,
          isNewConversation: isNewChat,
        });

        // Apply context-aware style directive (PLAN.md Step 4-5)
        const styleDirective = await this.styleRouter.getStyleDirective(contactId, contactName, contextType);
        if (styleDirective.styleInstructions) {
          contextConfig.systemPromptAdditions = [...(contextConfig.systemPromptAdditions || []), styleDirective.styleInstructions];
        }

        // Build messages with enriched context
        const historyMessages: AIMessage[] = history.map(h => ({
          role: h.role as AIMessage['role'],
          content: h.content,
        }));

        return this.contextBuilder.buildMessages(contextConfig, historyMessages, messageContent);
      } catch (err: any) {
        this.logger.warn({ contactId, error: err.message }, 'Context building failed, falling back to v1');
        // Fall back to v1 behavior
      }
    }

    // v1 fallback: simple system prompt + history
    const messages: AIMessage[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...history.map(h => ({ role: h.role as AIMessage['role'], content: h.content })),
      { role: 'user', content: messageContent },
    ];

    return messages;
  }

  /**
   * Auto-generate a conversation summary if the conversation has grown large.
   * Runs asynchronously (fire-and-forget) to not block the message response.
   */
  private async autoSummarizeConversation(contactId: string): Promise<void> {
    if (!this._memoryEnabled || !this._autoSummarizeEnabled) return;

    // Check if we have a summarizer to use
    const summarizer = this.summarizer || new Summarizer({ aiConfig: this.config });

    // Check if conversation needs summarization
    if (!this.memoryManager.needsSummarization(contactId, this._autoSummarizeThreshold)) return;

    // Generate and save summary
    const summary = await this.memoryManager.generateAndSaveSummary(contactId, summarizer);
    if (summary) {
      this.logger.info({ contactId }, 'Auto-summarization completed');
      // Optionally compact old memory files after summarization
      this.memoryManager.compactMemoryAfterSummary(contactId);
    }
  }

  /**
   * Auto-learn from the completed interaction.
   * Runs asynchronously (fire-and-forget) to not block the message response.
   */
  private async learnFromInteraction(
    userMessage: string,
    aiResponse: string,
    contactId: string,
    contactName: string,
  ): Promise<LearningResult | null> {
    if (!this._memoryEnabled || !this._autoLearnEnabled) return null;

    // Create Learner lazily if not provided
    const learner = this.learner || new Learner(this.memoryManager, this.styleRouter);

    // Get recent entries for style analysis
    const recentEntries = this.memoryManager.readRecentMemory(contactId, 30);

    const result = await learner.learnFromInteraction(
      contactId,
      contactName,
      userMessage,
      aiResponse,
      recentEntries,
    );

    return result;
  }

  async processMessage(
    messageContent: string,
    contactId: string,
    contactName: string
  ): Promise<{ response: string; pendingMessages: import('./types.js').PendingMessage[] }> {
    this.logger.info({ contactId, contactName }, 'Processing message from %s', contactName);

    // Build context using v2 sub-components (with v1 fallback)
    const messages = await this.buildContext(messageContent, contactId, contactName);

    // Save user message to DB conversation history (always)
    this.db.addConversation(contactId, 'user', messageContent);

    const pendingMessages: import('./types.js').PendingMessage[] = [];
    const toolContext: ToolContext = {
      logger: this.logger,
      db: this.db,
      config: this.config,
      contactId,
      knowledgeStore: this.knowledgeStore,
      scheduler: this._scheduler,
      pendingMessages,
    };

    let iterations = 0;
    let finalResponse = '';

    while (iterations < this.maxToolIterations) {
      iterations++;
      this.logger.debug({ iteration: iterations }, 'AI agent iteration');

      try {
        const response = await this.provider.chat(messages, this.tools);

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Push one assistant message with all tool_calls data
          messages.push({
            role: 'assistant',
            content: response.content || '',
          });

          // Execute each tool and push tool results
          for (const toolCall of response.toolCalls) {
            const tool = this.tools.find(t => t.name === toolCall.function.name);
            if (!tool) {
              this.logger.warn({ toolName: toolCall.function.name }, 'Unknown tool called');
              messages.push({
                role: 'tool',
                content: `Error: Tool "${toolCall.function.name}" tidak dikenal`,
                tool_call_id: toolCall.id,
              });
              continue;
            }

            // ── Check if tool requires human approval ────────────
            if (this.approvalQueue && this.approvalRequiredTools.has(tool.name)) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                const approvalId = this.approvalQueue.enqueue({
                  type: tool.name === 'create_order' ? 'create_order' :
                        tool.name === 'send_image' ? 'send_image' : 'execute_tool',
                  title: `Execute: ${tool.name}`,
                  description: `AI ingin menjalankan tool ${tool.name}`,
                  source: 'agent',
                  contactId: toolContext.contactId,
                  toolName: tool.name,
                  args,
                  reason: `Tool ${tool.name} requires approval before execution`,
                  aiReasoning: response.content || undefined,
                });

                this.logger.info({ tool: tool.name, approvalId }, 'Tool execution queued for approval');

                messages.push({
                  role: 'tool',
                  content: JSON.stringify({
                    pending: true,
                    approvalId,
                    message: `Tindakan "${tool.name}" membutuhkan persetujuan. ID: ${approvalId}. Menunggu persetujuan...`,
                  }),
                  tool_call_id: toolCall.id,
                });
                continue;
              } catch (err: any) {
                this.logger.error({ tool: tool.name, error: err.message }, 'Approval check failed');
                // Fall through to execute normally
              }
            }

            try {
              const args = JSON.parse(toolCall.function.arguments);
              this.logger.info({ tool: tool.name, args }, 'Executing tool: %s', tool.name);
              const result = await tool.handler(args, toolContext);
              this.logger.debug({ tool: tool.name, result }, 'Tool result');

              // Push tool result message with matching tool_call_id
              messages.push({
                role: 'tool',
                content: result,
                tool_call_id: toolCall.id,
              });
            } catch (err: any) {
              this.logger.error({ tool: tool.name, error: err.message }, 'Tool execution failed');
              messages.push({
                role: 'tool',
                content: `Error executing ${tool.name}: ${err.message}`,
                tool_call_id: toolCall.id,
              });
            }
          }
          continue; // Let AI respond to tool results
        }

        // Final response from AI
        finalResponse = response.content;

        if (response.usage) {
          this.logger.info({
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          }, 'AI response tokens');
        }

        break;
      } catch (err: any) {
        this.logger.error({ error: err.message }, 'AI provider error');
        if (iterations === 1) {
          finalResponse = `Maaf, saya mengalami kendala teknis. Silakan coba lagi nanti. 🙏`;
        }
        break;
      }
    }

    // Save AI response to conversation history
    if (finalResponse) {
      this.db.addConversation(contactId, 'assistant', finalResponse);
    }

    // Trim conversation history if too long
    this.db.trimConversation(contactId, 60);

    // Trigger auto-summarization asynchronously (non-blocking)
    if (this._memoryEnabled && this._autoSummarizeEnabled) {
      this.autoSummarizeConversation(contactId).catch(err => {
        this.logger.warn({ contactId, error: err.message }, 'Auto-summarization failed');
      });
    }

    // Trigger auto-learning asynchronously (non-blocking)
    if (this._memoryEnabled && this._autoLearnEnabled) {
      this.learnFromInteraction(messageContent, finalResponse, contactId, contactName).catch(err => {
        this.logger.warn({ contactId, error: err.message }, 'Auto-learning failed');
      });
    }

    this.logger.info({ contactId }, 'Response sent to %s', contactName);
    return { response: finalResponse, pendingMessages };
  }
}
