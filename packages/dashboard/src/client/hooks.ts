import { useState, useEffect, useCallback, useRef } from 'react';

const WS_URL = `ws://${window.location.hostname}:${window.location.port === '5173' ? '3030' : window.location.port}`;

type MessageHandler = (data: any) => void;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let isDestroyed = false;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isDestroyed) setConnected(true);
      };

      ws.onclose = () => {
        if (!isDestroyed) {
          setConnected(false);
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const typeHandlers = handlersRef.current.get(data.type);
          if (typeHandlers) {
            typeHandlers.forEach((handler) => handler(data));
          }
          // Wildcard handlers
          const allHandlers = handlersRef.current.get('*');
          if (allHandlers) {
            allHandlers.forEach((handler) => handler(data));
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      isDestroyed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const on = useCallback((type: string, handler: MessageHandler): () => void => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const request = useCallback((type: string, data?: object) => {
    return new Promise<any>((resolve) => {
      const handler = (response: any) => {
        cleanup();
        resolve(response);
      };
      const cleanup = on(type, handler);
      send({ type, ...data });
      // Timeout after 10s
      setTimeout(() => {
        cleanup();
        resolve(null);
      }, 10000);
    });
  }, [send, on]);

  return { connected, send, on, request };
}

// ── Formatting Utilities ───────────────────────────────────────

export function formatTime(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60000) return 'baru saja';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m lalu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}j lalu`;

  return d.toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export function formatPhone(jid: string): string {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
