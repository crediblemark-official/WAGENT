import React, { useState, useEffect } from 'react';

interface CatalogModel {
  id: string;
  name: string;
  provider: string;
}

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // States untuk setelan
  const [model, setModel] = useState('google/gemini-3.1-flash-lite');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('Halo! Ada yang bisa saya bantu?');
  
  // API Keys
  const [googleKey, setGoogleKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');

  // Perilaku
  const [autoReply, setAutoReply] = useState(true);
  const [groupChatEnabled, setGroupChatEnabled] = useState(false);
  
  // Raw config placeholder untuk preserve field lain
  const [rawConfig, setRawConfig] = useState<any>({});

  // Dynamic Catalog dari models.dev
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('google');

  // Load settings & models catalog dari backend
  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(res => res.json()),
      fetch('/api/models').then(res => res.json()).catch(() => ({ models: [] }))
    ])
      .then(([settingsData, modelsData]) => {
        const cfg = settingsData.config || {};
        setRawConfig(cfg);

        // Map values ke state
        if (cfg.model) {
          setModel(cfg.model);
          // Auto-detect provider dari model ID (contoh: "google/gemini" -> "google")
          const parts = cfg.model.split('/');
          if (parts.length > 0) {
            setSelectedProvider(parts[0]);
          }
        }
        if (settingsData.systemPrompt) setSystemPrompt(settingsData.systemPrompt);
        if (cfg.agent?.welcomeMessage) setWelcomeMessage(cfg.agent.welcomeMessage);
        
        // Map API keys
        if (cfg.providers?.google?.apiKey) setGoogleKey(cfg.providers.google.apiKey);
        if (cfg.providers?.openai?.apiKey) setOpenaiKey(cfg.providers.openai.apiKey);
        if (cfg.providers?.anthropic?.apiKey) setAnthropicKey(cfg.providers.anthropic.apiKey);
        if (cfg.providers?.groq?.apiKey) setGroqKey(cfg.providers.groq.apiKey);
        if (cfg.providers?.deepseek?.apiKey) setDeepseekKey(cfg.providers.deepseek.apiKey);

        // Map toggles
        if (cfg.groupChat?.enabled !== undefined) setGroupChatEnabled(cfg.groupChat.enabled);
        if (cfg.agent?.autoReply !== undefined) setAutoReply(cfg.agent.autoReply);

        // Map Catalog Models
        if (modelsData?.models) {
          setCatalogModels(modelsData.models);
        }
      })
      .catch((err) => {
        setError('Gagal memuat konfigurasi dari backend');
      })
      .finally(() => setLoading(false));
  }, []);

  // Filter models berdasarkan provider terpilih
  const filteredModels = catalogModels.filter(m => m.provider === selectedProvider);

  // Daftar provider unik dari catalog (fallback ke list dasar jika kosong)
  const availableProviders = catalogModels.length > 0 
    ? Array.from(new Set(catalogModels.map(m => m.provider))).sort()
    : ['google', 'openai', 'anthropic', 'groq', 'deepseek', 'ollama'];

  const handleProviderChange = (prov: string) => {
    setSelectedProvider(prov);
    // Pilih model pertama dari provider baru tersebut sebagai default
    const firstModel = catalogModels.find(m => m.provider === prov);
    if (firstModel) {
      setModel(firstModel.id);
    } else {
      setModel(`${prov}/`);
    }
  };

  const handleSave = async () => {
    setError(null);
    try {
      // Rekonstruksi config object
      const updatedConfig = {
        ...rawConfig,
        model: model.trim(),
        providers: {
          ...rawConfig.providers,
          google: {
            ...rawConfig.providers?.google,
            apiKey: googleKey.trim()
          },
          openai: {
            ...rawConfig.providers?.openai,
            apiKey: openaiKey.trim()
          },
          anthropic: {
            ...rawConfig.providers?.anthropic,
            apiKey: anthropicKey.trim()
          },
          groq: {
            ...rawConfig.providers?.groq,
            apiKey: groqKey.trim()
          },
          deepseek: {
            ...rawConfig.providers?.deepseek,
            apiKey: deepseekKey.trim()
          }
        },
        agent: {
          ...rawConfig.agent,
          welcomeMessage: welcomeMessage.trim(),
          autoReply: autoReply
        },
        groupChat: {
          ...rawConfig.groupChat,
          enabled: groupChatEnabled
        }
      };

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: updatedConfig,
          systemPrompt: systemPrompt
        }),
      });

      if (!response.ok) {
        throw new Error('Server mengembalikan respon error');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan konfigurasi');
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: '#8696a0', fontSize: 13 }}>Memuat pengaturan...</div>;
  }

  return (
    <div style={{
      padding: '16px 20px',
      maxWidth: 850,
      overflowY: 'auto',
      height: '100%',
      backgroundColor: '#0b141a',
      color: '#e9edef',
      boxSizing: 'border-box'
    }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e9edef', margin: 0 }}>Pengaturan WAGENT</h2>
        <p style={{ fontSize: 12, color: '#8696a0', marginTop: 4, margin: 0 }}>
          Konfigurasi model AI dari models.dev, kredensial provider API, dan respon WhatsApp Anda.
        </p>
      </div>

      {error && (
        <div style={{
          padding: 10, borderRadius: 6, background: 'rgba(239, 68, 68, 0.1)',
          color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)',
          fontSize: 12, marginBottom: 16
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Grid Layout untuk Compact View */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 16 }}>
        
        {/* Kolom Kiri: AI & Model (models.dev integration) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          <Section title="Pilih Model AI (models.dev)" description="Pilih provider dan model secara dinamis dari database models.dev">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              
              {/* Dropdown Provider */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 12, color: '#e9edef', minWidth: 100 }}>AI Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  style={{ ...styles.input, width: '100%', maxWidth: 260, cursor: 'pointer' }}
                >
                  {availableProviders.map(prov => (
                    <option key={prov} value={prov}>
                      {prov.charAt(0).toUpperCase() + prov.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dropdown Model */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 12, color: '#e9edef', minWidth: 100 }}>Model AI</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ ...styles.input, width: '100%', maxWidth: 260, cursor: 'pointer' }}
                >
                  {filteredModels.length > 0 ? (
                    filteredModels.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.id.split('/')[1]})
                      </option>
                    ))
                  ) : (
                    <option value={model}>{model || 'Tulis manual di bawah...'}</option>
                  )}
                </select>
              </div>

              {/* Input Manual / Edit Model ID */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid #222e35', paddingTop: 10, marginTop: 4 }}>
                <label style={{ fontSize: 11, color: '#8696a0', minWidth: 100 }}>Model ID Aktif</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="ID Model aktif"
                  style={{ ...styles.input, padding: '5px 8px', fontSize: 11, width: '100%', maxWidth: 260 }}
                />
              </div>

            </div>
          </Section>

          <Section title="Kredensial API Provider" description="Masukkan API Key untuk mengaktifkan provider">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <InputRow label="Google Gemini" value={googleKey} onChange={setGoogleKey} placeholder="Google/Gemini API Key" type="password" />
              <InputRow label="OpenAI" value={openaiKey} onChange={setOpenaiKey} placeholder="sk-..." type="password" />
              <InputRow label="Anthropic" value={anthropicKey} onChange={setAnthropicKey} placeholder="sk-ant-..." type="password" />
              <InputRow label="Groq" value={groqKey} onChange={setGroqKey} placeholder="gsk_..." type="password" />
              <InputRow label="DeepSeek" value={deepseekKey} onChange={setDeepseekKey} placeholder="sk-..." type="password" />
            </div>
          </Section>

        </div>

        {/* Kolom Kanan: Perilaku & WhatsApp */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          <Section title="Perilaku WhatsApp Agent" description="Atur kapan dan bagaimana AI merespon pesan">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ToggleRow
                label="Aktifkan Auto-Reply AI"
                description="AI akan membalas otomatis setiap chat masuk"
                checked={autoReply}
                onChange={setAutoReply}
              />
              <ToggleRow
                label="Balas di Pesan Grup"
                description="Izinkan AI membalas otomatis pesan di grup chat"
                checked={groupChatEnabled}
                onChange={setGroupChatEnabled}
              />
            </div>
          </Section>

          <Section title="Pesan Sambutan (Welcome)" description="Pesan pertama yang dikirim ke kontak baru">
            <input
              type="text"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Halo! Ada yang bisa saya bantu?"
              style={styles.input}
            />
          </Section>

        </div>

      </div>

      {/* Baris Penuh: System Prompt */}
      <div style={{ marginBottom: 20 }}>
        <Section title="Instruksi System Prompt AI" description="Persona, gaya bicara, dan aturan utama agen (disimpan langsung di system.md)">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={7}
            placeholder="Tulis instruksi sistem untuk AI Anda di sini..."
            style={{
              ...styles.input,
              resize: 'vertical',
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          />
        </Section>
      </div>

      {/* Save Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <button
          onClick={handleSave}
          style={{
            padding: '10px 24px',
            borderRadius: 20,
            border: 'none',
            background: saved ? '#25d366' : '#00a884', // WhatsApp Teal / Green
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          }}
        >
          {saved ? '✓ Tersimpan!' : 'Simpan Setelan'}
        </button>
      </div>
    </div>
  );
}

// ── Helper Components ───────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#111b21',
      borderRadius: 10,
      border: '1px solid #222e35',
      padding: '14px 16px',
      boxSizing: 'border-box'
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: '#e9edef', margin: '0 0 2px 0' }}>{title}</h3>
      <p style={{ fontSize: 11, color: '#8696a0', margin: '0 0 12px 0' }}>{description}</p>
      {children}
    </div>
  );
}

function InputRow({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <label style={{ fontSize: 12, color: '#e9edef', minWidth: 100 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...styles.input, padding: '6px 10px', fontSize: 12, width: '100%', maxWidth: 260 }}
      />
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#e9edef' }}>{label}</div>
        <div style={{ fontSize: 10, color: '#8696a0', marginTop: 2 }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 18,
          borderRadius: 9,
          border: 'none',
          background: checked ? '#00a884' : '#3b4a54', // WhatsApp Teal / Gray
          cursor: 'pointer',
          position: 'relative' as const,
          transition: 'background 0.2s',
          padding: 0,
        }}
      >
        <div style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute' as const,
          top: 2,
          left: checked ? 20 : 2,
          transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

const styles = {
  input: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #222e35',
    background: '#202c33', // WhatsApp input dark
    color: '#e9edef',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  }
};
