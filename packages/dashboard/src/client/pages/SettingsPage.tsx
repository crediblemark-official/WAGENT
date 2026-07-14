import React, { useState } from 'react';

export function SettingsPage() {
  const [systemPrompt, setSystemPrompt] = useState(
    'Kamu adalah customer service yang ramah, profesional, dan membantu. Balaslah dengan bahasa Indonesia yang natural dan sopan.'
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
              style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid #1e2030',
                background: provider === 'OpenAI' ? 'rgba(139, 92, 246, 0.1)' : '#161822',
                color: provider === 'OpenAI' ? '#8b5cf6' : '#94a3b8',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                borderColor: provider === 'OpenAI' ? '#8b5cf6' : '#1e2030',
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
          <ToggleRow label="Aktifkan auto-reply" description="Balas pesan otomatis dengan AI" checked={true} />
          <ToggleRow label="Balas pesan grup" description="Izinkan AI merespon di grup" checked={false} />
          <ToggleRow label="Simpan riwayat chat" description="Simpan percakapan ke database" checked={true} />
        </div>
      </Section>

      {/* Multi-Number */}
      <Section title="Multi-Number" description="Kelola beberapa nomor WhatsApp">
        <div style={{
          padding: 16, background: '#0f1117', borderRadius: 8, border: '1px dashed #1e2030',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Fitur multi-number akan tersedia di versi berikutnya
          </p>
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

function ToggleRow({ label, description, checked }: { label: string; description: string; checked: boolean }) {
  const [isChecked, setIsChecked] = useState(checked);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>{description}</div>
      </div>
      <button
        onClick={() => setIsChecked(!isChecked)}
        style={{
          width: 40, height: 22, borderRadius: 11, border: 'none',
          background: isChecked ? '#8b5cf6' : '#334155',
          cursor: 'pointer', position: 'relative' as const,
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute' as const, top: 2,
          left: isChecked ? 20 : 2, transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}
