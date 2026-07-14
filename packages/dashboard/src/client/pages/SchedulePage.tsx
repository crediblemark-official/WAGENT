import React, { useState, useEffect } from 'react';
import { useWebSocket, formatTime } from '../hooks';

interface ScheduledMessage {
  id: string;
  contactId: string;
  contactName: string;
  content: string;
  scheduledAt: Date;
  repeat: string;
  status: string;
  lastSentAt?: Date;
  nextRunAt?: Date;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
}

export function SchedulePage({ ws }: { ws: ReturnType<typeof useWebSocket> }) {
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    contactId: '',
    contactName: '',
    content: '',
    scheduledDate: '',
    scheduledTime: '',
    repeat: 'none',
  });

  // Load scheduled messages
  useEffect(() => {
    // Initial load
    ws.send({ type: 'get:scheduled' });

    // Handle initial list
    const unsubList = ws.on('scheduled:list', (data) => {
      if (Array.isArray(data.scheduled)) {
        setMessages(data.scheduled);
      }
    });

    // Handle create/update
    const unsubUpdate = ws.on('scheduled:update', (data) => {
      if (!data.scheduled?.id) return;
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === data.scheduled.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = data.scheduled;
          return updated;
        }
        return [data.scheduled, ...prev];
      });
    });

    // Handle deletion
    const unsubDelete = ws.on('scheduled:deleted', (data) => {
      if (data.id) {
        setMessages(prev => prev.filter(m => m.id !== data.id));
      }
    });

    return () => { unsubList(); unsubUpdate(); unsubDelete(); };
  }, [ws]);

  const handleCreate = () => {
    if (!formData.content.trim() || !formData.contactId) return;

    const scheduledAt = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`);
    const newMessage: ScheduledMessage = {
      id: Date.now().toString(),
      contactId: formData.contactId,
      contactName: formData.contactName || formData.contactId,
      content: formData.content,
      scheduledAt,
      repeat: formData.repeat as any,
      status: 'pending',
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };

    // Send to backend — UI updates via broadcast response
    ws.send({ type: 'scheduled:create', scheduled: newMessage });
    setShowForm(false);
    setFormData({ contactId: '', contactName: '', content: '', scheduledDate: '', scheduledTime: '', repeat: 'none' });
  };

  const handleCancel = (id: string) => {
    ws.send({ type: 'scheduled:cancel', id });
  };

  const handleDelete = (id: string) => {
    ws.send({ type: 'scheduled:delete', id });
  };

  const statusColors: Record<string, string> = {
    pending: '#eab308',
    active: '#3b82f6',
    sent: '#22c55e',
    failed: '#ef4444',
    cancelled: '#64748b',
  };

  const statusLabels: Record<string, string> = {
    pending: 'Menunggu',
    active: 'Mengirim',
    sent: 'Terkirim',
    failed: 'Gagal',
    cancelled: 'Dibatalkan',
  };

  const repeatLabels: Record<string, string> = {
    none: 'Sekali',
    daily: 'Harian',
    weekly: 'Mingguan',
    monthly: 'Bulanan',
  };

  // Separate upcoming and past messages
  const now = new Date();
  const upcoming = messages.filter(m => m.status !== 'sent' && m.status !== 'cancelled')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const history = messages.filter(m => m.status === 'sent' || m.status === 'cancelled')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>Pesan Terjadwal</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Jadwalkan pesan otomatis ke kontak tertentu
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: showForm ? '#ef4444' : '#8b5cf6',
            color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {showForm ? 'Batal' : '+ Jadwalkan Pesan'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div style={{
          background: '#161822', borderRadius: 12, border: '1px solid #1e2030',
          padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>
                ID Kontak (JID)
              </label>
              <input
                value={formData.contactId}
                onChange={(e) => setFormData(f => ({ ...f, contactId: e.target.value }))}
                placeholder="628xxx@s.whatsapp.net"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>
                Nama Kontak
              </label>
              <input
                value={formData.contactName}
                onChange={(e) => setFormData(f => ({ ...f, contactName: e.target.value }))}
                placeholder="Nama customer"
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>
              Isi Pesan
            </label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData(f => ({ ...f, content: e.target.value }))}
              placeholder="Tulis pesan yang akan dikirim..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' as const, fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>
                Tanggal
              </label>
              <input
                type="date"
                value={formData.scheduledDate}
                onChange={(e) => setFormData(f => ({ ...f, scheduledDate: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>
                Waktu
              </label>
              <input
                type="time"
                value={formData.scheduledTime}
                onChange={(e) => setFormData(f => ({ ...f, scheduledTime: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, display: 'block' }}>
                Ulangi
              </label>
              <select
                value={formData.repeat}
                onChange={(e) => setFormData(f => ({ ...f, repeat: e.target.value }))}
                style={inputStyle}
              >
                <option value="none">Sekali</option>
                <option value="daily">Harian</option>
                <option value="weekly">Mingguan</option>
                <option value="monthly">Bulanan</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={!formData.content || !formData.contactId || !formData.scheduledDate || !formData.scheduledTime}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none', alignSelf: 'flex-end',
              background: '#8b5cf6', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: !formData.content || !formData.contactId || !formData.scheduledDate || !formData.scheduledTime ? 0.5 : 1,
            }}
          >
            Buat Jadwal
          </button>
        </div>
      )}

      {/* Upcoming Messages */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Akan Datang ({upcoming.length})
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {upcoming.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#475569' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" style={{ margin: '0 auto 8px' }}>
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <p style={{ fontSize: 13 }}>Belum ada jadwal</p>
            </div>
          ) : (
            upcoming.map(msg => (
              <div key={msg.id} style={{
                background: '#161822', borderRadius: 10, border: '1px solid #1e2030',
                padding: '14px 18px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, marginRight: 16 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 500 }}>{msg.contactName}</span>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 6,
                        background: `${statusColors[msg.status]}20`,
                        color: statusColors[msg.status], fontWeight: 600,
                      }}>
                        {statusLabels[msg.status] || msg.status}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>{msg.content}</p>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#64748b' }}>
                      <span>📅 {formatTime(msg.scheduledAt)}</span>
                      {msg.repeat !== 'none' && <span>🔄 {repeatLabels[msg.repeat]}</span>}
                      {msg.sentCount > 0 && <span>✅ Terkirim: {msg.sentCount}x</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {msg.status === 'pending' && (
                      <button onClick={() => handleCancel(msg.id)} style={iconBtnStyle} title="Batalkan">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                    <button onClick={() => handleDelete(msg.id)} style={iconBtnStyle} title="Hapus">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Riwayat ({history.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map(msg => (
                <div key={msg.id} style={{
                  background: '#161822', borderRadius: 10, border: '1px solid #1e2030',
                  padding: '12px 18px', opacity: 0.7,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: '#e2e8f0' }}>{msg.contactName}</span>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 6,
                          background: `${statusColors[msg.status]}20`,
                          color: statusColors[msg.status], fontWeight: 600,
                        }}>
                          {statusLabels[msg.status] || msg.status}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: '#64748b' }}>{msg.content.substring(0, 60)}{msg.content.length > 60 ? '...' : ''}</p>
                    </div>
                    <div style={{ fontSize: 11, color: '#475569' }}>
                      {formatTime(msg.scheduledAt)} {msg.repeat !== 'none' && `· ${repeatLabels[msg.repeat]}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #1e2030',
  background: '#0f1117', color: '#e2e8f0', fontSize: 13, outline: 'none',
  boxSizing: 'border-box' as const,
};

const iconBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 6, border: 'none',
  background: 'transparent', cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};
