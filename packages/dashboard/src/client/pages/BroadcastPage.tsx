import React, { useState, useEffect } from 'react';
import { useWebSocket, formatTime } from '../hooks';

interface Broadcast {
  id: string; content: string; status: string;
  totalContacts: number; sentCount: number; failedCount: number;
  createdAt: Date; completedAt?: Date;
}

export function BroadcastPage({ ws }: { ws: ReturnType<typeof useWebSocket> }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    ws.request('get:broadcasts', undefined, 'broadcasts').then((data) => {
      if (data?.broadcasts) setBroadcasts(data.broadcasts);
    });

    const unsub = ws.on('broadcasts', (data) => {
      if (data.broadcasts) setBroadcasts(data.broadcasts);
    });

    const unsub2 = ws.on('broadcast:update', (data) => {
      if (data.broadcast) {
        setBroadcasts(prev => {
          const idx = prev.findIndex(b => b.id === data.broadcast.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = data.broadcast;
            return updated;
          }
          return [data.broadcast, ...prev];
        });
      }
    });

    return () => { unsub(); unsub2(); };
  }, [ws]);

  const handleSend = () => {
    if (!message.trim()) return;
    const newBroadcast: Broadcast = {
      id: Date.now().toString(),
      content: message,
      status: 'pending',
      totalContacts: 0,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };
    setBroadcasts(prev => [newBroadcast, ...prev]);
    setMessage('');
    setShowForm(false);
  };

  const statusColors: Record<string, string> = {
    pending: '#eab308', sending: '#3b82f6',
    completed: '#22c55e', failed: '#ef4444', cancelled: '#64748b',
  };

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>Broadcast</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Kirim pesan massal ke kontak</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: '#8b5cf6', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {showForm ? 'Batal' : '+ Broadcast Baru'}
        </button>
      </div>

      {/* New Broadcast Form */}
      {showForm && (
        <div style={{ background: '#161822', borderRadius: 12, border: '1px solid #1e2030', padding: 20, marginBottom: 24 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8, display: 'block' }}>
            Isi Pesan Broadcast
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tulis pesan yang akan dikirim ke semua kontak..."
            rows={4}
            style={{
              width: '100%', padding: 12, borderRadius: 8, border: '1px solid #1e2030',
              background: '#0f1117', color: '#e2e8f0', fontSize: 14, resize: 'vertical' as const,
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={handleSend}
              disabled={!message.trim()}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: message.trim() ? '#8b5cf6' : '#334155',
                color: '#fff', fontSize: 13, fontWeight: 600, cursor: message.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Kirim Broadcast
            </button>
          </div>
        </div>
      )}

      {/* Broadcast History */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {broadcasts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            <p>Belum ada broadcast</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {broadcasts.map(b => (
              <div key={b.id} style={{
                background: '#161822', borderRadius: 10, border: '1px solid #1e2030',
                padding: '14px 18px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 14, color: '#e2e8f0', flex: 1, marginRight: 16 }}>{b.content}</div>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 6,
                    background: `${statusColors[b.status]}20`,
                    color: statusColors[b.status],
                    fontWeight: 600, whiteSpace: 'nowrap' as const,
                  }}>
                    {b.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b' }}>
                  <span>Total: {b.totalContacts}</span>
                  <span style={{ color: '#22c55e' }}>Terkirim: {b.sentCount}</span>
                  <span style={{ color: '#ef4444' }}>Gagal: {b.failedCount}</span>
                  <span>{formatTime(b.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
