import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../event-bus.js';
import { GatewayEvent } from '../types.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on', () => {
    it('should register handler for event type', () => {
      const handler = vi.fn();
      bus.on('message', handler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should register multiple handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.on('message', handler1);
      bus.on('message', handler2);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe('onAny', () => {
    it('should register wildcard handler', () => {
      const handler = vi.fn();
      bus.onAny(handler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should receive all event types', () => {
      const handler = vi.fn();
      bus.onAny(handler);

      const messageEvent: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      const statusEvent: GatewayEvent = {
        type: 'status',
        data: { status: 'connected' },
        timestamp: new Date(),
      };

      bus.emit(messageEvent);
      bus.emit(statusEvent);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(messageEvent);
      expect(handler).toHaveBeenCalledWith(statusEvent);
    });
  });

  describe('off', () => {
    it('should unregister handler', () => {
      const handler = vi.fn();
      bus.on('message', handler);
      bus.off('message', handler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('offAny', () => {
    it('should unregister wildcard handler', () => {
      const handler = vi.fn();
      bus.onAny(handler);
      bus.offAny(handler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    it('should emit to type-specific handlers', () => {
      const messageHandler = vi.fn();
      const statusHandler = vi.fn();

      bus.on('message', messageHandler);
      bus.on('status', statusHandler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(messageHandler).toHaveBeenCalledOnce();
      expect(statusHandler).not.toHaveBeenCalled();
    });

    it('should emit to wildcard handlers', () => {
      const wildcardHandler = vi.fn();
      bus.onAny(wildcardHandler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(wildcardHandler).toHaveBeenCalledOnce();
    });

    it('should handle errors in handlers gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const faultyHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });

      const goodHandler = vi.fn();
      bus.on('message', faultyHandler);
      bus.on('message', goodHandler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(faultyHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle errors in wildcard handlers gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const faultyHandler = vi.fn().mockImplementation(() => {
        throw new Error('Wildcard error');
      });

      bus.onAny(faultyHandler);

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(faultyHandler).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('removeAll', () => {
    it('should remove all handlers', () => {
      const typeHandler = vi.fn();
      const wildcardHandler = vi.fn();

      bus.on('message', typeHandler);
      bus.onAny(wildcardHandler);

      bus.removeAll();

      const event: GatewayEvent = {
        type: 'message',
        data: { id: '1', from: 'test', body: 'hello', timestamp: new Date() },
        timestamp: new Date(),
      };

      bus.emit(event);
      expect(typeHandler).not.toHaveBeenCalled();
      expect(wildcardHandler).not.toHaveBeenCalled();
    });
  });
});