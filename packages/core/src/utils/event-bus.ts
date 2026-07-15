import { GatewayEvent, GatewayEventHandler } from '../types.js';
import { Logger } from 'pino';
import { getLogger } from './logger.js';

export class EventBus {
  private handlers: Map<GatewayEvent['type'], Set<GatewayEventHandler>> = new Map();
  private wildcardHandlers: Set<GatewayEventHandler> = new Set();
  private logger: Logger = getLogger();

  on(eventType: GatewayEvent['type'], handler: GatewayEventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  onAny(handler: GatewayEventHandler): void {
    this.wildcardHandlers.add(handler);
  }

  off(eventType: GatewayEvent['type'], handler: GatewayEventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  offAny(handler: GatewayEventHandler): void {
    this.wildcardHandlers.delete(handler);
  }

  emit(event: GatewayEvent): void {
    // Dispatch to type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Error in event handler for ${event.type}:`, err);
        }
      }
    }

    // Dispatch to wildcard handlers
    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Error in wildcard event handler:', err);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }
}
