import React, { useState, useEffect } from 'react';

export function SettingsPage() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('OpenAI');
  const [autoReply, setAutoReply] = useState(true);
  const [replyGroups, setReplyGroups] = useState(false);
  const [saveHistory, setSaveHistory] = useState(true);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [sessionName, setSessionName] = useState('');

  // Load settings from backend
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.agent?.systemPrompt) setSystemPrompt(data.agent.systemPrompt);
        if (data.model?.provider) setSelectedProvider(data.model.provider);
        if (data.agent?.autoReply !== undefined) setAutoReply(data.agent.autoReply);
        if (data.agent?.replyGroups !== undefined) setReplyGroups(data.agent.replyGroups);
        if (data.agent?.saveHistory !== undefined) setSaveHistory(data.agent.saveHistory);
        if (data.whatsappSessionName) setSessionName(data.whatsappSessionName);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: {
            systemPrompt,
            autoReply,
            replyGroups,
            saveHistory,
          },
          model: {
            provider: selectedProvider,
          },
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9' }}>Pengaturan</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Konfigurasi AI agent dan dashboard</p>
      </div>

      {/* AI Provider */}
      <Section title="AI Provider" description="Pilih penyedia AI untuk agent">
        <div style={{ display: 'flex', gap: 8 }}>
          {['OpenAI', 'Gemini', 'Claude', 'Ollama'].map(provider => (
            <button
              key={provider}
              onClick={() => setSelectedProvider(provider)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid #1e2030',
                background: provider === selectedProvider ? 'rgba(139, 92, 246, 0.1)' : '#161822',
                color: provider === selectedProvider ? '#8b5cf6' : '#94a3b8',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                borderColor: provider === selectedProvider ? '#8b5cf6' : '#1e2030',
                transition: 'all 0.15s',
              }}
            >
              {provider}
            </button>
          ))}
        </div>
      </Section>

      {/* System Prompt */}
      <Section title="System Prompt" description="Instruksi awal untuk AI agent">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={5}
          style={{
            width: '100%', padding: 12, borderRadius: 8, border: '1px solid #1e2030',
            background: '#0f1117', color: '#e2e8f0', fontSize: 13, resize: 'vertical' as const,
            outline: 'none', fontFamily: 'inherit', lineHeight: 1.6,
          }}
        />
      </Section>

      {/* Auto Reply Settings */}
      <Section title="Auto Reply" description="Atur perilaku auto-reply agent">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ToggleRow label="Aktifkan auto-reply" description="Balas pesan otomatis dengan AI" checked={autoReply} onChange={setAutoReply} />
          <ToggleRow label="Balas pesan grup" description="Izinkan AI merespon di grup" checked={replyGroups} onChange={setReplyGroups} />
          <ToggleRow label="Simpan riwayat chat" description="Simpan percakapan ke database" checked={saveHistory} onChange={setSaveHistory} />
        </div>
      </Section>

      {/* Multi-Number */}
      <Section title="Multi-Number" description="Kelola beberapa nomor WhatsApp">
        <div style={{
          padding: 16, background: '#0f1117', borderRadius: 8, border: '1px solid #1e2030',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
            Pengelolaan multi-number dapat diakses secara langsung melalui menu utama "Nomor WA".
          </p>
          {sessionName && (
            <span style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 600 }}>
              Sesi Utama Aktif: {sessionName}
            </span>
          )}
        </div>
      </Section>

      {/* Save Button */}
      <button
        onClick={handleSave}
        style={{
          padding: '12px 32px', borderRadius: 8, border: 'none',
          background: saved ? '#22c55e' : '#8b5cf6',
          color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          transition: 'all 0.2s', marginTop: 8,
        }}
      >
        {saved ? '✓ Tersimpan!' : 'Simpan Pengaturan'}
      </button>
    </div>
  );
}

// ── Components ──────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#161822', borderRadius: 12, border: '1px solid #1e2030',
      padding: 20, marginBottom: 16,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>{title}</h3>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{description}</p>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 40, height: 22, borderRadius: 11, border: 'none',
          background: checked ? '#8b5cf6' : '#334155',
          cursor: 'pointer', position: 'relative' as const,
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute' as const, top: 2,
          left: checked ? 20 : 2, transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}
