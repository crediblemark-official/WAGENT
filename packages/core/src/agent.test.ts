import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from './agent.js';
import { Database } from './storage.js';
import { WAgentConfig, ToolDefinition, ToolContext } from './types.js';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// Mock global fetch for OpenAI API calls
const mockFetch = vi.fn();

describe('Agent', () => {
  let db: Database;
  let agent: Agent;
  let config: WAgentConfig;
  let TEST_DB: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'wagent-agent-'));
    TEST_DB = join(dir, 'test.db');
    db = new Database(TEST_DB);

    config = {
      whatsappSessionName: 'test',
      aiProvider: 'openai',
      systemPrompt: 'Kamu adalah customer service yang ramah.',
      dashboardPort: 3030,
      dashboardHost: 'localhost',
      databaseType: 'sqlite',
      databaseUrl: TEST_DB,
      openai: { apiKey: 'sk-test', model: 'gpt-4o-mini' },
    };

    vi.resetAllMocks();
    // @ts-ignore
    globalThis.fetch = mockFetch;

    // Save contacts to satisfy FK constraints
    const contact = { id: '628123@s.whatsapp.net', name: 'Budi', number: '628123', isGroup: false, createdAt: new Date(), updatedAt: new Date() };
    db.saveContact(contact);
    db.saveContact({ ...contact, id: 'test-user@s.whatsapp.net', name: 'Tester' });
    db.saveContact({ ...contact, id: 'error-user@s.whatsapp.net', name: 'Error User' });
    db.saveContact({ ...contact, id: 'tool-user@s.whatsapp.net', name: 'Tool User' });
  });

  afterEach(() => {
    db.close();
    const dir = dirname(TEST_DB);
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    try { rmdirSync(dir); } catch {}
  });

  describe('initialization', () => {
    it('should create agent with correct provider name', () => {
      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      expect(agent.getProviderName()).toBe('OpenAI');
    });

    it('should have built-in tools', () => {
      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const tools = agent.getTools();
      expect(tools.length).toBeGreaterThan(0);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('get_customer_info');
      expect(toolNames).toContain('get_current_time');
      expect(toolNames).toContain('get_conversation_history');
    });
  });

  describe('processMessage', () => {
    it('should return a response from the AI provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Halo! Ada yang bisa saya bantu?' },
            tool_calls: undefined,
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Halo, ada promo?',
        '628123@s.whatsapp.net',
        'Budi'
      );

      expect(response).toBe('Halo! Ada yang bisa saya bantu?');
    });

    it('should save conversation history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Test response' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      await agent.processMessage('Pesan test', 'test-user@s.whatsapp.net', 'Tester');

      const history = (db as any).getConversationHistory('test-user@s.whatsapp.net');
      expect(history.length).toBe(2); // user + assistant
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Pesan test');
      expect(history[1].role).toBe('assistant');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Halo',
        'error-user@s.whatsapp.net',
        'Error User'
      );

      // Should return a fallback message on error
      expect(response).toContain('Maaf');
    });

    it('should execute tools when AI calls them', async () => {
      // First call returns a tool call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: { name: 'get_current_time', arguments: '{}' },
              }],
            },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      // Second call returns the final response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Sekarang jam 10:00 WIB.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Jam berapa sekarang?',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      expect(response).toBe('Sekarang jam 10:00 WIB.');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom tools', () => {
    it('should include extra tools passed to constructor', () => {
      const customTool: ToolDefinition = {
        name: 'custom_tool',
        description: 'A custom test tool',
        parameters: { type: 'object', properties: {} },
        handler: async () => 'custom result',
      };

      agent = new Agent(config, db, [customTool], { autoSummarizeEnabled: false });
      const tools = agent.getTools();
      expect(tools.find(t => t.name === 'custom_tool')).toBeDefined();
    });
  });

  describe('tool error recovery', () => {
    it('should handle tool execution failure gracefully', async () => {
      // Inject a custom tool that throws to trigger the error catch block
      const throwingTool: ToolDefinition = {
        name: 'throwing_tool',
        description: 'A tool that always throws',
        parameters: { type: 'object', properties: {} },
        handler: async () => { throw new Error('Database connection lost'); },
      };

      // AI calls the throwing tool
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-throw',
                type: 'function',
                function: { name: 'throwing_tool', arguments: '{}' },
              }],
            },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      // Second call: AI responds after seeing the tool error message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Maaf, ada kendala teknis.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(config, db, [throwingTool], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Panggil tool error',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      // Should still return a response despite tool failure
      expect(response).toContain('kendala teknis');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle unknown tool calls gracefully', async () => {
      // AI calls a tool that doesn't exist
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-unknown',
                type: 'function',
                function: { name: 'nonexistent_tool', arguments: '{}' },
              }],
            },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Tool tidak dikenal.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Panggil tool aneh',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      expect(response).toContain('tidak dikenal');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle malformed tool arguments JSON', async () => {
      // AI returns invalid JSON in tool arguments
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-bad-json',
                type: 'function',
                function: { name: 'get_current_time', arguments: '{bad json}' },
              }],
            },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OK, saya coba lagi.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Test',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      expect(response).toContain('coba lagi');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple tool calls in one response', async () => {
      // AI calls TWO tools in one response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'get_current_time', arguments: '{}' },
                },
                {
                  id: 'call-2',
                  type: 'function',
                  function: { name: 'get_customer_info', arguments: '{"query":"Budi"}' },
                },
              ],
            },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Informasi lengkap.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Cari info',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      expect(response).toContain('Informasi lengkap');
      // First call with 2 tools + second call = 2 API calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('provider errors', () => {
    it('should throw when OpenAI config is missing', () => {
      const noKeyConfig: WAgentConfig = {
        ...config,
        openai: undefined,
      };
      expect(() => new Agent(noKeyConfig, db)).toThrow('OpenAI API key not configured');
    });

    it('should throw when Gemini config is missing', () => {
      const noKeyConfig: WAgentConfig = {
        ...config,
        aiProvider: 'gemini',
        gemini: undefined,
      };
      expect(() => new Agent(noKeyConfig, db)).toThrow('Gemini API key not configured');
    });

    it('should throw when Claude config is missing', () => {
      const noKeyConfig: WAgentConfig = {
        ...config,
        aiProvider: 'claude',
        anthropic: undefined,
      };
      expect(() => new Agent(noKeyConfig, db)).toThrow('Anthropic API key not configured');
    });

    it('should throw when Ollama config is missing', () => {
      const noKeyConfig: WAgentConfig = {
        ...config,
        aiProvider: 'ollama',
        ollama: undefined,
      };
      expect(() => new Agent(noKeyConfig, db)).toThrow('Ollama base URL not configured');
    });

    it('should throw for unknown provider', () => {
      const badConfig: WAgentConfig = {
        ...config,
        aiProvider: 'unknown' as any,
      };
      expect(() => new Agent(badConfig, db)).toThrow('Unknown AI provider');
    });
  });

  describe('Gemini provider', () => {
    beforeEach(() => {
      config = {
        ...config,
        aiProvider: 'gemini',
        gemini: { apiKey: 'gemini-key', model: 'gemini-2.0-flash' },
        openai: undefined,
      };
    });

    it('should process message with Gemini provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: 'Halo dari Gemini!' }],
            },
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
          },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      expect(agent.getProviderName()).toBe('Gemini');

      const response = await agent.processMessage(
        'Halo Gemini',
        '628123@s.whatsapp.net',
        'Budi'
      );

      expect(response).toBe('Halo dari Gemini!');
    });

    it('should handle Gemini API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'API key not valid',
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Halo',
        'error-user@s.whatsapp.net',
        'Error User'
      );

      expect(response).toContain('Maaf');
    });
  });

  describe('Claude provider', () => {
    beforeEach(() => {
      config = {
        ...config,
        aiProvider: 'claude',
        anthropic: { apiKey: 'sk-ant-test', model: 'claude-sonnet-4-20250514' },
        openai: undefined,
      };
    });

    it('should process message with Claude provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Halo dari Claude!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      expect(agent.getProviderName()).toBe('Claude');

      const response = await agent.processMessage(
        'Halo Claude',
        '628123@s.whatsapp.net',
        'Budi'
      );

      expect(response).toBe('Halo dari Claude!');
    });

    it('should handle Claude API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Halo',
        'error-user@s.whatsapp.net',
        'Error User'
      );

      expect(response).toContain('Maaf');
    });
  });

  describe('Ollama provider', () => {
    beforeEach(() => {
      config = {
        ...config,
        aiProvider: 'ollama',
        ollama: { baseUrl: 'http://localhost:11434', model: 'llama3' },
        openai: undefined,
      };
    });

    it('should process message with Ollama provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Halo dari Ollama!' },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      expect(agent.getProviderName()).toBe('Ollama');

      const response = await agent.processMessage(
        'Halo Ollama',
        '628123@s.whatsapp.net',
        'Budi'
      );

      expect(response).toBe('Halo dari Ollama!');
    });

    it('should handle Ollama API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Halo',
        'error-user@s.whatsapp.net',
        'Error User'
      );

      expect(response).toContain('Maaf');
    });
  });

  describe('edge cases', () => {
    it('should handle empty AI response content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }],
          usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
        }),
      });

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Test',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      // Empty response should be returned
      expect(response).toBe('');
      // The conversation should NOT have an assistant message saved (empty)
      const history = (db as any).getConversationHistory('tool-user@s.whatsapp.net');
      const assistantMessages = history.filter((h: any) => h.role === 'assistant');
      expect(assistantMessages).toHaveLength(0);
    });

    it('should exit loop when AI keeps calling tools beyond max iterations', async () => {
      // Setup: AI calls a tool on EVERY iteration up to maxToolIterations (10)
      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: '',
                tool_calls: [{
                  id: `call-${i}`,
                  type: 'function',
                  function: { name: 'get_current_time', arguments: '{}' },
                }],
              },
            }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        });
      }

      agent = new Agent(config, db, [], { autoSummarizeEnabled: false });
      const response = await agent.processMessage(
        'Loop test',
        'tool-user@s.whatsapp.net',
        'Tool User'
      );

      // After 10 iterations, loop exits with empty finalResponse (AI never gave a text response)
      expect(response).toBe('');
      expect(mockFetch).toHaveBeenCalledTimes(10);
    });
  });
});
