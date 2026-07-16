import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WAgentConfig, AIMessage, ToolDefinition } from '../types.js';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

const mockDb = {
  addConversation: vi.fn(),
  getConversationHistory: vi.fn().mockReturnValue([]),
  trimConversation: vi.fn(),
  getContactProfile: vi.fn().mockReturnValue(null),
  saveContactProfile: vi.fn(),
};

vi.mock('../storage/index.js', () => ({
  Database: vi.fn().mockImplementation(() => mockDb),
}));

const mockCreateBuiltInTools = vi.fn().mockReturnValue([]);
vi.mock('../tools/tools.js', () => ({
  createBuiltInTools: (...args: any[]) => mockCreateBuiltInTools(...args),
}));

vi.mock('./memory-manager.js', () => {
  return {
    MemoryManager: class MockMemoryManager {
      appendMemory = vi.fn();
      loadConversationSummary = vi.fn().mockResolvedValue(null);
      compactMemory = vi.fn();
      compactMemoryAfterSummary = vi.fn();
      getRecentEntries = vi.fn().mockResolvedValue([]);
      readRecentMemory = vi.fn().mockReturnValue([]);
      needsSummarization = vi.fn().mockReturnValue(false);
      generateAndSaveSummary = vi.fn().mockResolvedValue(null);
    },
  };
});

vi.mock('./context-builder.js', () => {
  return {
    ContextBuilder: class MockContextBuilder {
      createConfig = vi.fn().mockReturnValue({
        baseSystemPrompt: 'Test system prompt',
        systemPromptAdditions: [],
      });
      buildMessages = vi.fn().mockReturnValue([
        { role: 'system', content: 'Test system prompt' },
      ]);
      buildSystemPrompt = vi.fn().mockReturnValue('Test system prompt');
    },
  };
});

vi.mock('../utils/style-router.js', () => {
  return {
    StyleRouter: class MockStyleRouter {
      constructor(_memoryManager: any) {}
      detectContextType = vi.fn().mockReturnValue('casual');
      getOrCreateProfile = vi.fn().mockResolvedValue({
        name: 'Test',
        tone: 'casual',
      });
      getStyleDirective = vi.fn().mockResolvedValue({
        tone: 'casual',
        styleInstructions: 'Be casual',
        examples: [],
      });
    },
  };
});

vi.mock('../services/approval-queue.js', () => {
  return {
    ApprovalQueue: class MockApprovalQueue {
      enqueue = vi.fn().mockResolvedValue('approval-123');
    },
  };
});

vi.mock('./summarizer.js', () => {
  return {
    Summarizer: class MockSummarizer {
      generateSummary = vi.fn().mockResolvedValue('Summary');
      saveSummary = vi.fn();
    },
  };
});

vi.mock('./learner.js', () => {
  return {
    Learner: class MockLearner {
      learnFromInteraction = vi.fn().mockResolvedValue({
        profileUpdated: false,
        factsExtracted: 0,
        patternsDetected: 0,
        correctionsApplied: 0,
        summary: 'No new patterns',
      });
    },
  };
});

vi.mock('../rag/knowledge-store.js', () => {
  return {
    KnowledgeStore: class MockKnowledgeStore {},
  };
});

// ── Global fetch mock ────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ──────────────────────────────────────────────────────

function makeConfig(overrides: Partial<WAgentConfig['resolvedModel']> = {}): WAgentConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'You are a helpful assistant.',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: './test.db',
    resolvedModel: {
      input: 'text',
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-api-key',
      baseUrl: 'https://api.openai.com/v1',
      ...overrides,
    },
  } as WAgentConfig;
}

function openAiTextResponse(content = 'Hello!') {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };
}

function openAiToolCallResponse(toolName: string, args: Record<string, unknown>, callId = 'call_123') {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: callId,
            type: 'function',
            function: { name: toolName, arguments: JSON.stringify(args) },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };
}

function openAiErrorResponse(status = 500, body = 'Internal Server Error') {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockResolvedValue({}),
  };
}

// ── Import Agent after mocks ─────────────────────────────────────

import { Agent } from '../agent/agent.js';

// ── Tests ────────────────────────────────────────────────────────

describe('Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getConversationHistory.mockReturnValue([]);
    mockFetch.mockReset();
  });

  // ── Provider selection ──────────────────────────────────────────

  describe('Provider selection', () => {
    it('creates OpenAI provider for "openai"', () => {
      agent = new Agent(makeConfig({ provider: 'openai' }), mockDb as any);
      expect(agent.getProviderName()).toBe('openai');
    });

    it('creates Gemini provider for "google"', () => {
      agent = new Agent(makeConfig({ provider: 'google' }), mockDb as any);
      expect(agent.getProviderName()).toBe('Gemini');
    });

    it('creates Claude provider for "anthropic"', () => {
      agent = new Agent(makeConfig({ provider: 'anthropic' }), mockDb as any);
      expect(agent.getProviderName()).toBe('Claude');
    });

    it('creates Ollama provider for "ollama"', () => {
      agent = new Agent(makeConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434/api' }), mockDb as any);
      expect(agent.getProviderName()).toBe('Ollama');
    });

    it('defaults to OpenAI for unknown provider', () => {
      agent = new Agent(makeConfig({ provider: 'deepseek', name: 'DeepSeek' }), mockDb as any);
      expect(agent.getProviderName()).toBe('DeepSeek');
    });
  });

  // ── Getter methods ──────────────────────────────────────────────

  describe('Getter methods', () => {
    beforeEach(() => {
      agent = new Agent(makeConfig(), mockDb as any);
    });

    it('getProviderName returns provider name', () => {
      expect(agent.getProviderName()).toBe('openai');
    });

    it('getTools returns tools array', () => {
      expect(agent.getTools()).toEqual([]);
    });

    it('getMemoryManager returns memory manager', () => {
      expect(agent.getMemoryManager()).toBeDefined();
    });

    it('getContextBuilder returns context builder', () => {
      expect(agent.getContextBuilder()).toBeDefined();
    });
  });

  // ── Toggle methods ──────────────────────────────────────────────

  describe('Toggle methods', () => {
    beforeEach(() => {
      agent = new Agent(makeConfig(), mockDb as any);
    });

    it('setMemoryEnabled toggles memory', () => {
      agent.setMemoryEnabled(false);
      expect((agent as any)._memoryEnabled).toBe(false);
      agent.setMemoryEnabled(true);
      expect((agent as any)._memoryEnabled).toBe(true);
    });

    it('setStyleEnabled toggles style', () => {
      agent.setStyleEnabled(false);
      expect((agent as any)._styleEnabled).toBe(false);
    });

    it('setAutoSummarizeEnabled toggles summarization', () => {
      agent.setAutoSummarizeEnabled(false);
      expect((agent as any)._autoSummarizeEnabled).toBe(false);
    });

    it('setAutoSummarizeThreshold sets threshold', () => {
      agent.setAutoSummarizeThreshold(50);
      expect((agent as any)._autoSummarizeThreshold).toBe(50);
    });

    it('setAutoLearnEnabled toggles learning', () => {
      agent.setAutoLearnEnabled(false);
      expect((agent as any)._autoLearnEnabled).toBe(false);
    });

    it('isAutoLearnEnabled returns current state', () => {
      expect(agent.isAutoLearnEnabled()).toBe(true);
      agent.setAutoLearnEnabled(false);
      expect(agent.isAutoLearnEnabled()).toBe(false);
    });
  });

  // ── Tool approval ───────────────────────────────────────────────

  describe('Tool approval', () => {
    beforeEach(() => {
      agent = new Agent(makeConfig(), mockDb as any);
    });

    it('setApprovalRequiredTools sets tools requiring approval', () => {
      agent.setApprovalRequiredTools(['custom_tool']);
      expect(agent.isToolApprovalRequired('custom_tool')).toBe(true);
      expect(agent.isToolApprovalRequired('send_message')).toBe(false);
    });

    it('addApprovalRequiredTool adds single tool', () => {
      agent.addApprovalRequiredTool('new_tool');
      expect(agent.isToolApprovalRequired('new_tool')).toBe(true);
    });

    it('isToolApprovalRequired checks correctly', () => {
      expect(agent.isToolApprovalRequired('send_message')).toBe(true);
      expect(agent.isToolApprovalRequired('send_image')).toBe(true);
      expect(agent.isToolApprovalRequired('create_order')).toBe(true);
      expect(agent.isToolApprovalRequired('get_weather')).toBe(false);
    });
  });

  // ── processMessage — simple response ────────────────────────────

  describe('processMessage — simple response', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue(openAiTextResponse('Hello there!'));
      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });
    });

    it('returns AI text response', async () => {
      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toBe('Hello there!');
    });

    it('saves user message to DB', async () => {
      await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(mockDb.addConversation).toHaveBeenCalledWith('contact-1', 'user', 'Hi');
    });

    it('saves AI response to DB', async () => {
      await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(mockDb.addConversation).toHaveBeenCalledWith('contact-1', 'assistant', 'Hello there!');
    });

    it('trims conversation after response', async () => {
      await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(mockDb.trimConversation).toHaveBeenCalledWith('contact-1', 60);
    });
  });

  // ── processMessage — tool execution ─────────────────────────────

  describe('processMessage — tool execution', () => {
    it('executes tool calls from AI', async () => {
      const handler = vi.fn().mockResolvedValue('Tool executed');
      const tool: ToolDefinition = {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} },
        handler,
      };
      mockCreateBuiltInTools.mockReturnValue([tool]);

      mockFetch
        .mockResolvedValueOnce(openAiToolCallResponse('get_weather', { city: 'Jakarta' }))
        .mockResolvedValueOnce(openAiTextResponse('The weather in Jakarta is sunny.'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      const { response } = await agent.processMessage('Weather?', 'contact-1', 'Alice');
      expect(handler).toHaveBeenCalledWith({ city: 'Jakarta' }, expect.objectContaining({ contactId: 'contact-1' }));
      expect(response).toBe('The weather in Jakarta is sunny.');
    });

    it('returns tool result to AI in next iteration', async () => {
      const handler = vi.fn().mockResolvedValue('42°C');
      const tool: ToolDefinition = {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} },
        handler,
      };
      mockCreateBuiltInTools.mockReturnValue([tool]);

      mockFetch
        .mockResolvedValueOnce(openAiToolCallResponse('get_weather', {}))
        .mockResolvedValueOnce(openAiTextResponse('It is 42°C'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      await agent.processMessage('Hi', 'contact-1', 'Alice');

      const secondCall = mockFetch.mock.calls[1];
      const body = JSON.parse(secondCall[1].body);
      const toolResultMsg = body.messages.find((m: any) => m.role === 'tool');
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content).toBe('42°C');
    });

    it('handles unknown tool gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce(openAiToolCallResponse('nonexistent_tool', {}))
        .mockResolvedValueOnce(openAiTextResponse('Sorry, I could not do that.'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toBe('Sorry, I could not do that.');
    });

    it('tool execution error is caught and returned to AI', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Network timeout'));
      const tool: ToolDefinition = {
        name: 'failing_tool',
        description: 'A tool that fails',
        parameters: { type: 'object', properties: {} },
        handler,
      };
      mockCreateBuiltInTools.mockReturnValue([tool]);

      mockFetch
        .mockResolvedValueOnce(openAiToolCallResponse('failing_tool', {}))
        .mockResolvedValueOnce(openAiTextResponse('Sorry, the tool failed.'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toBe('Sorry, the tool failed.');

      const secondCall = mockFetch.mock.calls[1];
      const body = JSON.parse(secondCall[1].body);
      const toolResultMsg = body.messages.find((m: any) => m.role === 'tool');
      expect(toolResultMsg.content).toContain('Error executing failing_tool');
      expect(toolResultMsg.content).toContain('Network timeout');
    });
  });

  // ── processMessage — approval ───────────────────────────────────

  describe('processMessage — approval', () => {
    it('approval-required tool is queued instead of executed', async () => {
      const handler = vi.fn();
      const tool: ToolDefinition = {
        name: 'send_message',
        description: 'Send a message',
        parameters: { type: 'object', properties: {} },
        handler,
      };
      mockCreateBuiltInTools.mockReturnValue([tool]);

      const mockEnqueue = vi.fn().mockResolvedValue('approval-abc');

      mockFetch
        .mockResolvedValueOnce(openAiToolCallResponse('send_message', { to: '123', content: 'hi' }))
        .mockResolvedValueOnce(openAiTextResponse('Message queued.'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      (agent as any).approvalQueue = { enqueue: mockEnqueue };

      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(mockEnqueue).toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
      expect(response).toBe('Message queued.');
    });

    it('pending message is returned for approved tool', async () => {
      const handler = vi.fn().mockResolvedValue('sent');
      const tool: ToolDefinition = {
        name: 'send_message',
        description: 'Send a message',
        parameters: { type: 'object', properties: {} },
        handler,
      };
      mockCreateBuiltInTools.mockReturnValue([tool]);

      const mockEnqueue = vi.fn().mockResolvedValue('approval-xyz');

      mockFetch
        .mockResolvedValueOnce(openAiToolCallResponse('send_message', { to: '123', content: 'hi' }))
        .mockResolvedValueOnce(openAiTextResponse('Done.'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      (agent as any).approvalQueue = { enqueue: mockEnqueue };

      const { response, pendingMessages } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toBe('Done.');
      expect(pendingMessages).toBeDefined();
    });
  });

  // ── processMessage — error handling ─────────────────────────────

  describe('processMessage — error handling', () => {
    it('API error returns friendly error message', async () => {
      mockFetch.mockResolvedValue(openAiErrorResponse(500, 'Server Error'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toContain('kendala teknis');
    });

    it('max 10 iterations prevents infinite loop', async () => {
      const tool: ToolDefinition = {
        name: 'loop_tool',
        description: 'Loops forever',
        parameters: { type: 'object', properties: {} },
        handler: vi.fn().mockResolvedValue('result'),
      };
      mockCreateBuiltInTools.mockReturnValue([tool]);

      for (let i = 0; i < 11; i++) {
        mockFetch.mockResolvedValueOnce(openAiToolCallResponse('loop_tool', {}));
      }

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      const { response } = await agent.processMessage('Loop', 'contact-1', 'Alice');
      expect(mockFetch).toHaveBeenCalledTimes(10);
      expect(response).toBe('');
    });

    it('empty tool calls array is handled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{
            message: { role: 'assistant', content: 'No tools needed.', tool_calls: [] },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toBe('No tools needed.');
    });
  });

  // ── Auto-operations ─────────────────────────────────────────────

  describe('Auto-operations', () => {
    it('auto-summarize fires when threshold exceeded', async () => {
      mockFetch.mockResolvedValue(openAiTextResponse('Ok'));

      const mockMM = {
        appendMemory: vi.fn(),
        loadConversationSummary: vi.fn().mockResolvedValue(null),
        compactMemory: vi.fn(),
        compactMemoryAfterSummary: vi.fn(),
        getRecentEntries: vi.fn().mockResolvedValue([]),
        readRecentMemory: vi.fn().mockReturnValue([]),
        needsSummarization: vi.fn().mockReturnValue(true),
        generateAndSaveSummary: vi.fn().mockResolvedValue('Summary text'),
      };

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryManager: mockMM as any,
        memoryEnabled: true,
        styleEnabled: false,
        autoSummarizeEnabled: true,
        autoLearnEnabled: false,
      });

      await agent.processMessage('Hi', 'contact-1', 'Alice');
      await new Promise(r => setTimeout(r, 50));
      expect(mockMM.needsSummarization).toHaveBeenCalledWith('contact-1', 20);
      expect(mockMM.generateAndSaveSummary).toHaveBeenCalled();
    });

    it('auto-summarize does not fire under threshold', async () => {
      mockFetch.mockResolvedValue(openAiTextResponse('Ok'));

      const mockMM = {
        appendMemory: vi.fn(),
        loadConversationSummary: vi.fn().mockResolvedValue(null),
        compactMemory: vi.fn(),
        compactMemoryAfterSummary: vi.fn(),
        getRecentEntries: vi.fn().mockResolvedValue([]),
        readRecentMemory: vi.fn().mockReturnValue([]),
        needsSummarization: vi.fn().mockReturnValue(false),
        generateAndSaveSummary: vi.fn().mockResolvedValue(null),
      };

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryManager: mockMM as any,
        memoryEnabled: true,
        styleEnabled: false,
        autoSummarizeEnabled: true,
        autoLearnEnabled: false,
      });

      await agent.processMessage('Hi', 'contact-1', 'Alice');
      await new Promise(r => setTimeout(r, 50));
      expect(mockMM.needsSummarization).toHaveBeenCalled();
      expect(mockMM.generateAndSaveSummary).not.toHaveBeenCalled();
    });

    it('auto-learn fires after response', async () => {
      mockFetch.mockResolvedValue(openAiTextResponse('Got it'));

      const mockLearnerInstance = {
        learnFromInteraction: vi.fn().mockResolvedValue({
          profileUpdated: false,
          factsExtracted: 0,
          patternsDetected: 0,
          correctionsApplied: 0,
          summary: 'Nothing new',
        }),
      };

      const mockMM = {
        appendMemory: vi.fn(),
        loadConversationSummary: vi.fn().mockResolvedValue(null),
        compactMemory: vi.fn(),
        compactMemoryAfterSummary: vi.fn(),
        getRecentEntries: vi.fn().mockResolvedValue([]),
        readRecentMemory: vi.fn().mockReturnValue([]),
        needsSummarization: vi.fn().mockReturnValue(false),
        generateAndSaveSummary: vi.fn(),
      };

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryManager: mockMM as any,
        learner: mockLearnerInstance as any,
        memoryEnabled: true,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: true,
      });

      await agent.processMessage('Hello', 'contact-1', 'Alice');
      await new Promise(r => setTimeout(r, 50));
      expect(mockLearnerInstance.learnFromInteraction).toHaveBeenCalledWith(
        'contact-1',
        'Alice',
        'Hello',
        'Got it',
        [],
      );
    });
  });

  // ── Context building ────────────────────────────────────────────

  describe('Context building', () => {
    it('uses enriched context when style enabled', async () => {
      mockFetch.mockResolvedValue(openAiTextResponse('Hi!'));

      const mockBuildMessages = vi.fn().mockReturnValue([
        { role: 'system', content: 'Enriched prompt' },
        { role: 'user', content: 'Hi' },
      ]);

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: true,
        styleEnabled: true,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      // Get the context builder instance and override buildMessages
      const cb = agent.getContextBuilder() as any;
      cb.buildMessages = mockBuildMessages;

      await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(mockBuildMessages).toHaveBeenCalled();

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const systemMsg = callBody.messages.find((m: any) => m.role === 'system');
      expect(systemMsg.content).toBe('Enriched prompt');
    });

    it('falls back to simple context on error', async () => {
      mockFetch.mockResolvedValue(openAiTextResponse('Fallback works'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: true,
        styleEnabled: true,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      // Override createConfig to throw, triggering fallback
      const cb = agent.getContextBuilder() as any;
      cb.createConfig = vi.fn().mockImplementation(() => {
        throw new Error('Context build failed');
      });

      const { response } = await agent.processMessage('Hi', 'contact-1', 'Alice');
      expect(response).toBe('Fallback works');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages[0].role).toBe('system');
      expect(callBody.messages[0].content).toBe('You are a helpful assistant.');
      expect(callBody.messages[1].role).toBe('user');
    });

    it('includes conversation history', async () => {
      mockDb.getConversationHistory.mockReturnValue([
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ]);
      mockFetch.mockResolvedValue(openAiTextResponse('Continuing'));

      agent = new Agent(makeConfig(), mockDb as any, [], {
        memoryEnabled: false,
        styleEnabled: false,
        autoSummarizeEnabled: false,
        autoLearnEnabled: false,
      });

      await agent.processMessage('Next question', 'contact-1', 'Alice');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(4);
      expect(callBody.messages[1].content).toBe('Previous question');
      expect(callBody.messages[2].content).toBe('Previous answer');
      expect(callBody.messages[3].content).toBe('Next question');
    });
  });
});
