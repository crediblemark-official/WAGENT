import React, { useState, useEffect } from 'react';
import { useWebSocket, formatTime, formatPhone } from '../hooks';

interface Contact {
  id: string; name: string; pushName?: string;
  number: string; isGroup: boolean;
  tags?: string[]; notes?: string;
  lastSeen?: Date; createdAt: Date;
}

export function ContactsPage({ ws }: { ws: ReturnType<typeof useWebSocket> }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);

  useEffect(() => {
    ws.request('get:contacts', undefined, 'contact:list').then((data) => {
      if (data?.contacts) setContacts(data.contacts);
    });

    const unsub = ws.on('contact:list', (data) => {
      if (data.contacts) setContacts(data.contacts);
    });

    return () => unsub();
  }, [ws]);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.number.includes(search) ||
    c.pushName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={styles.container}>
      <div style={styles.listPanel}>
        <div style={styles.header}>
          <h2 style={styles.title}>Kontak</h2>
          <span style={styles.count}>{contacts.length}</span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari kontak..."
          style={styles.searchInput}
        />
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filtered.map(contact => (
            <button
              key={contact.id}
              onClick={() => setSelected(contact)}
              style={{
                ...styles.contactItem,
                ...(selected?.id === contact.id ? styles.contactItemActive : {}),
              }}
            >
              <div style={styles.avatar}>
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.contactName}>{contact.name}</div>
                <div style={styles.contactNumber}>{formatPhone(contact.id)}</div>
              </div>
              {contact.tags && contact.tags.length > 0 && (
                <div style={styles.tagChip}>{contact.tags[0]}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      <div style={styles.detailPanel}>
        {selected ? (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ ...styles.avatar, width: 56, height: 56, fontSize: 22 }}>
                {selected.name.charAt(0)}
              </div>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>{selected.name}</h3>
                <p style={{ fontSize: 14, color: '#64748b' }}>{formatPhone(selected.id)}</p>
              </div>
            </div>

            <div style={styles.infoGrid}>
              <div style={styles.infoItem}>
                <label style={styles.label}>Push Name</label>
                <span style={styles.value}>{selected.pushName || '-'}</span>
              </div>
              <div style={styles.infoItem}>
                <label style={styles.label}>Tipe</label>
                <span style={styles.value}>{selected.isGroup ? 'Grup' : 'Individu'}</span>
              </div>
              <div style={styles.infoItem}>
                <label style={styles.label}>Terakhir Dilihat</label>
                <span style={styles.value}>{selected.lastSeen ? formatTime(selected.lastSeen) : '-'}</span>
              </div>
              <div style={styles.infoItem}>
                <label style={styles.label}>Bergabung</label>
                <span style={styles.value}>{new Date(selected.createdAt).toLocaleDateString('id-ID')}</span>
              </div>
            </div>

            {selected.tags && selected.tags.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <label style={styles.label}>Tags</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {selected.tags.map((tag, i) => (
                    <span key={i} style={styles.tag}>{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.notes && (
              <div style={{ marginTop: 20 }}>
                <label style={styles.label}>Catatan</label>
                <p style={{ ...styles.value, marginTop: 8, lineHeight: 1.6 }}>{selected.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div style={styles.emptyState}>
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            <p style={{ color: '#475569', marginTop: 16 }}>Pilih kontak untuk lihat detail</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%' },
  listPanel: { width: 360, borderRight: '1px solid #1e2030', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  header: { padding: '16px 20px', borderBottom: '1px solid #1e2030', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: 600, color: '#f1f5f9' },
  count: { fontSize: 12, color: '#94a3b8', background: '#1e2030', padding: '2px 8px', borderRadius: 10 },
  searchInput: { margin: '12px 16px', padding: '10px 14px', borderRadius: 8, border: '1px solid #1e2030', background: '#0f1117', color: '#e2e8f0', fontSize: 13, outline: 'none' },
  contactItem: { display: 'flex', gap: 12, padding: '10px 20px', border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', width: '100%', textAlign: 'left' as const, borderBottom: '1px solid #1a1c2e', alignItems: 'center' },
  contactItemActive: { background: 'rgba(139, 92, 246, 0.08)' },
  avatar: { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#fff', flexShrink: 0 },
  contactName: { fontSize: 14, fontWeight: 500, color: '#f1f5f9' },
  contactNumber: { fontSize: 12, color: '#64748b', marginTop: 1 },
  tagChip: { fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', flexShrink: 0 },
  detailPanel: { flex: 1, overflow: 'auto' },
  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  infoItem: { padding: '12px 16px', background: '#161822', borderRadius: 8, border: '1px solid #1e2030' },
  label: { fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  value: { fontSize: 14, color: '#e2e8f0', marginTop: 4 },
  tag: { fontSize: 12, padding: '4px 10px', borderRadius: 12, background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8' },
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
};
