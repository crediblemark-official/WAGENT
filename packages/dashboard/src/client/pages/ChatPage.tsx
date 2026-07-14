import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket, formatTime, formatPhone } from '../hooks';

interface Chat {
  id: string; contactId: string; contactName: string;
  lastMessage?: string; lastMessageAt?: Date;
  unreadCount: number; isGroup: boolean;
}

interface Message {
  id: string; from: string; to: string; content: string;
  type: string; timestamp: Date; fromMe: boolean;
}

interface Props {
  ws: ReturnType<typeof useWebSocket>;
  selectedChatId: string | null;
  onSelectChat: (id: string | null) => void;
}

export function ChatPage({ ws, selectedChatId, onSelectChat }: Props) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [humanActiveChats, setHumanActiveChats] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chats & human-active set
  useEffect(() => {
    ws.request('get:chats').then((data) => {
      if (data?.chats) setChats(data.chats);
    });

    ws.request('get:human-active').then((data) => {
      if (data?.chatIds) setHumanActiveChats(new Set(data.chatIds));
    });

    const unsub = ws.on('chat:list', (data) => {
      if (data.chats) setChats(data.chats);
    });

    const unsubMsg = ws.on('message:received', (data) => {
      if (data.message) {
        setChats(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(c => c.id === data.message.from);
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], lastMessage: data.message.content, lastMessageAt: data.message.timestamp, unreadCount: updated[idx].unreadCount + 1 };
          }
          return updated;
        });
      }
    });

    // Listen for human takeover events
    const unsubHuman = ws.on('human:active', (data) => {
      if (data.chatId) setHumanActiveChats(prev => new Set(prev).add(data.chatId));
    });
    const unsubHumanInactive = ws.on('human:inactive', (data) => {
      if (data.chatId) setHumanActiveChats(prev => { const next = new Set(prev); next.delete(data.chatId); return next; });
    });

    return () => { unsub(); unsubMsg(); unsubHuman(); unsubHumanInactive(); };
  }, [ws]);

  // Load messages when a chat is selected
  useEffect(() => {
    if (selectedChatId) {
      ws.request('get:messages', { chatId: selectedChatId }).then((data) => {
        if (data?.messages) setMessages(data.messages);
      });
    }
  }, [selectedChatId, ws]);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    // For real sending, this would go through the gateway
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      from: 'me',
      to: selectedChatId || '',
      content: inputText,
      type: 'text',
      timestamp: new Date(),
      fromMe: true,
    }]);
    setInputText('');
  }, [inputText, selectedChatId]);

  const sortedChats = [...chats].sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div style={styles.container}>
      {/* Chat List */}
      <div style={styles.chatList}>
        <div style={styles.header}>
          <h2 style={styles.title}>Percakapan</h2>
          <span style={styles.count}>{chats.length}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {sortedChats.map(chat => (
            <button
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              style={{
                ...styles.chatItem,
                ...(selectedChatId === chat.id ? styles.chatItemActive : {}),
              }}
            >
              <div style={styles.avatar}>
                {chat.contactName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.chatName}>{chat.contactName}</div>
                <div style={styles.chatPreview}>
                  {chat.lastMessage?.substring(0, 40) || 'Tidak ada pesan'}
                </div>
              </div>
              <div style={styles.chatMeta}>
                {humanActiveChats.has(chat.id) && (
                  <span style={styles.humanBadge}>🟡 Human</span>
                )}
                <span style={styles.chatTime}>
                  {chat.lastMessageAt ? formatTime(chat.lastMessageAt) : ''}
                </span>
                {chat.unreadCount > 0 && (
                  <span style={styles.badge}>{chat.unreadCount}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat View */}
      <div style={styles.chatView}>
        {selectedChatId ? (
          <>
            <div style={styles.chatHeader}>
              <div style={styles.avatar}>
                {chats.find(c => c.id === selectedChatId)?.contactName?.charAt(0) || '?'}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.chatName}>
                    {chats.find(c => c.id === selectedChatId)?.contactName || 'Unknown'}
                  </span>
                  {humanActiveChats.has(selectedChatId) && (
                    <span style={styles.humanBadge}>🟡 Human</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {formatPhone(selectedChatId)}
                </div>
              </div>
            </div>

            <div style={styles.messageList}>
              {messages.map(msg => (
                <div key={msg.id} style={{
                  ...styles.message,
                  ...(msg.fromMe ? styles.messageOut : styles.messageIn),
                }}>
                  <div style={styles.messageContent}>{msg.content}</div>
                  <div style={{
                    ...styles.messageTime,
                    textAlign: msg.fromMe ? 'right' as const : 'left' as const,
                  }}>
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div style={styles.inputBar}>
              <input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ketik pesan..."
                style={styles.input}
              />
              <button onClick={handleSend} style={styles.sendButton}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </>
        ) : (
          <div style={styles.emptyState}>
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <p style={{ color: '#475569', marginTop: 16 }}>Pilih percakapan untuk mulai chat</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%' },
  chatList: { width: 320, borderRight: '1px solid #1e2030', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  header: { padding: '16px 20px', borderBottom: '1px solid #1e2030', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: 600, color: '#f1f5f9' },
  count: { fontSize: 12, color: '#94a3b8', background: '#1e2030', padding: '2px 8px', borderRadius: 10 },
  chatItem: { display: 'flex', gap: 12, padding: '12px 20px', border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', width: '100%', textAlign: 'left' as const, borderBottom: '1px solid #1a1c2e', transition: 'background 0.15s' },
  chatItemActive: { background: 'rgba(139, 92, 246, 0.08)' },
  avatar: { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#fff', flexShrink: 0 },
  chatName: { fontSize: 14, fontWeight: 500, color: '#f1f5f9', marginBottom: 2 },
  chatPreview: { fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  chatMeta: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  chatTime: { fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' as const },
  badge: { background: '#8b5cf6', color: '#fff', fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600 },
  humanBadge: { background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap' as const },
  chatView: { flex: 1, display: 'flex', flexDirection: 'column' },
  chatHeader: { padding: '12px 20px', borderBottom: '1px solid #1e2030', display: 'flex', alignItems: 'center', gap: 12 },
  messageList: { flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 },
  message: { maxWidth: '70%', padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5 },
  messageIn: { alignSelf: 'flex-start', background: '#1e2030', borderBottomLeftRadius: 4 },
  messageOut: { alignSelf: 'flex-end', background: '#8b5cf6', borderBottomRightRadius: 4 },
  messageContent: { color: '#e2e8f0', wordBreak: 'break-word' as const },
  messageTime: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  inputBar: { padding: '12px 16px', borderTop: '1px solid #1e2030', display: 'flex', gap: 8, background: '#161822' },
  input: { flex: 1, padding: '10px 16px', borderRadius: 8, border: '1px solid #1e2030', background: '#0f1117', color: '#e2e8f0', fontSize: 14, outline: 'none' },
  sendButton: { width: 40, height: 40, borderRadius: 8, border: 'none', background: '#8b5cf6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
};
