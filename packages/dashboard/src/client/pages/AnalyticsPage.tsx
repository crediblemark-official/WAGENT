import React, { useState, useEffect } from 'react';
import { useWebSocket, formatNumber } from '../hooks';

interface Stats {
  date: string; totalMessages: number; incomingMessages: number;
  outgoingMessages: number; uniqueContacts: number;
  aiResponseCount: number; averageResponseTime: number;
}

export function AnalyticsPage({ ws }: { ws: ReturnType<typeof useWebSocket> }) {
  const [stats, setStats] = useState<Stats[]>([]);
  const [days, setDays] = useState(7);

  useEffect(() => {
    ws.request('get:stats', { days }, 'stats:update').then((data) => {
      if (data?.stats) setStats(data.stats);
    });

    const unsub = ws.on('stats:update', (data) => {
      if (data.stats) setStats(data.stats);
    });

    return () => unsub();
  }, [ws, days]);

  const totals = stats.reduce((acc, s) => ({
    total: acc.total + s.totalMessages,
    incoming: acc.incoming + s.incomingMessages,
    outgoing: acc.outgoing + s.outgoingMessages,
    contacts: Math.max(acc.contacts, s.uniqueContacts),
    ai: acc.ai + s.aiResponseCount,
  }), { total: 0, incoming: 0, outgoing: 0, contacts: 0, ai: 0 });

  const maxVal = Math.max(...stats.map(s => s.totalMessages), 1);

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>Analytics</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Statistik dan performa AI agent</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #1e2030',
            background: '#161822', color: '#e2e8f0', fontSize: 13, outline: 'none',
          }}
        >
          <option value={7}>7 Hari</option>
          <option value={14}>14 Hari</option>
          <option value={30}>30 Hari</option>
          <option value={90}>90 Hari</option>
        </select>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Pesan', value: formatNumber(totals.total), color: '#8b5cf6' },
          { label: 'Pesan Masuk', value: formatNumber(totals.incoming), color: '#3b82f6' },
          { label: 'Pesan Keluar', value: formatNumber(totals.outgoing), color: '#22c55e' },
          { label: 'Kontak Unik', value: formatNumber(totals.contacts), color: '#eab308' },
        ].map(card => (
          <div key={card.label} style={{
            background: '#161822', borderRadius: 12, border: '1px solid #1e2030',
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
              {card.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: card.color, marginTop: 8 }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      <div style={{
        background: '#161822', borderRadius: 12, border: '1px solid #1e2030',
        padding: 20, marginBottom: 24,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', marginBottom: 16 }}>
          Pesan per Hari
        </h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }}>
          {stats.map(s => {
            const height = (s.totalMessages / maxVal) * 140;
            return (
              <div key={s.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: '100%', height: Math.max(height, 2), borderRadius: '4px 4px 0 0',
                  background: 'linear-gradient(180deg, #8b5cf6, #6366f1)',
                  transition: 'height 0.3s ease',
                  minHeight: 2,
                }} />
                <span style={{ fontSize: 9, color: '#64748b', whiteSpace: 'nowrap' as const }}>
                  {new Date(s.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats Table */}
      <div style={{
        background: '#161822', borderRadius: 12, border: '1px solid #1e2030', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e2030' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>Detail Harian</h3>
        </div>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' as const }}>
            <thead>
              <tr style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase' as const }}>
                <th style={th}>Tanggal</th>
                <th style={th}>Total</th>
                <th style={th}>Masuk</th>
                <th style={th}>Keluar</th>
                <th style={th}>Kontak</th>
                <th style={th}>AI Respon</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.date} style={{ borderTop: '1px solid #1a1c2e' }}>
                  <td style={td}>
                    {new Date(s.date).toLocaleDateString('id-ID', {
                      weekday: 'short', day: 'numeric', month: 'short',
                    })}
                  </td>
                  <td style={td}>{s.totalMessages}</td>
                  <td style={{ ...td, color: '#3b82f6' }}>{s.incomingMessages}</td>
                  <td style={{ ...td, color: '#22c55e' }}>{s.outgoingMessages}</td>
                  <td style={td}>{s.uniqueContacts}</td>
                  <td style={td}>{s.aiResponseCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left' as const, padding: '10px 16px', fontWeight: 600,
};
const td: React.CSSProperties = {
  padding: '10px 16px', color: '#e2e8f0',
};
