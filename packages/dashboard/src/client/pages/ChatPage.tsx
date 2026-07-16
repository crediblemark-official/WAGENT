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
    ws.request('get:chats', undefined, 'chat:list').then((data) => {
      if (data?.chats) setChats(data.chats);
    });

    ws.request('get:human-active', undefined, 'human:active:list').then((data) => {
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
      ws.request('get:messages', { chatId: selectedChatId }, 'messages').then((data) => {
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
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
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
            <p style={{ color: 'var(--text-subtle)', marginTop: 16 }}>Pilih percakapan untuk mulai chat</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100%',
    backgroundColor: 'var(--bg-main)',
  },
  chatList: {
    width: 280,
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    backgroundColor: 'var(--bg-sidebar)',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'var(--bg-sidebar)',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-main)',
    margin: 0,
  },
  count: {
    fontSize: 11,
    color: 'var(--text-active)',
    background: 'var(--tag-bg)',
    padding: '2px 6px',
    borderRadius: 8,
    fontWeight: 600,
  },
  chatItem: {
    display: 'flex',
    gap: 10,
    padding: '10px 14px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-main)',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left' as const,
    borderBottom: '1px solid var(--border-color)',
    transition: 'background 0.1s',
  },
  chatItemActive: {
    background: 'var(--bg-active)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #008069, #25d366)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    flexShrink: 0,
  },
  chatName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-main)',
    marginBottom: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  chatPreview: {
    fontSize: 11,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  chatMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  chatTime: {
    fontSize: 10,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap' as const,
  },
  badge: {
    background: 'var(--text-active)',
    color: 'var(--bg-sidebar)',
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 8,
    fontWeight: 700,
  },
  humanBadge: {
    background: 'rgba(224, 185, 36, 0.15)',
    color: '#e0b924',
    fontSize: 9,
    padding: '1px 4px',
    borderRadius: 4,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  chatView: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--bg-main)',
    position: 'relative',
  },
  chatHeader: {
    padding: '10px 16px',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'var(--bg-header)',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  message: {
    maxWidth: '65%',
    padding: '6px 10px',
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.4,
    position: 'relative' as const,
  },
  messageIn: {
    alignSelf: 'flex-start',
    background: 'var(--bg-chat-in)',
    color: 'var(--text-main)',
    borderTopLeftRadius: 0,
    boxShadow: 'var(--shadow)',
  },
  messageOut: {
    alignSelf: 'flex-end',
    background: 'var(--bg-chat-out)',
    color: 'var(--text-main)',
    borderTopRightRadius: 0,
    boxShadow: 'var(--shadow)',
  },
  messageContent: {
    wordBreak: 'break-word' as const,
  },
  messageTime: {
    fontSize: 9,
    color: 'var(--text-muted)',
    marginTop: 4,
  },
  inputBar: {
    padding: '10px 14px',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    gap: 8,
    background: 'var(--bg-header)',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--bg-input)',
    color: 'var(--text-main)',
    fontSize: 13,
    outline: 'none',
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--text-active)',
    color: 'var(--bg-sidebar)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--bg-main)',
  },
};
