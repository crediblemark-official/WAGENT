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
  const [welcomeMessage, setWelcomeMessage] = useState('Halo! Ada yang bisa saya bantu?');
  
  // API Keys (Dinamis)
  const [apiKeys, setApiKeys] = useState<{ [providerId: string]: string }>({});

  const handleApiKeyChange = (provId: string, value: string) => {
    setApiKeys(prev => ({
      ...prev,
      [provId]: value
    }));
  };

  // Perilaku
  const [autoReply, setAutoReply] = useState(true);
  const [groupChatEnabled, setGroupChatEnabled] = useState(false);



  // Jam Kerja (Working Hours)
  const [whEnabled, setWhEnabled] = useState(false);
  const [whStart, setWhStart] = useState('08:00');
  const [whEnd, setWhEnd] = useState('17:00');
  const [whTimezone, setWhTimezone] = useState('Asia/Jakarta');
  const [whOfflineMsg, setWhOfflineMsg] = useState('Mohon maaf, saat ini di luar jam operasional.');

  // Rate Limiting
  const [rlMax, setRlMax] = useState(10);
  const [rlWindow, setRlWindow] = useState(10);
  const [rlMsg, setRlMsg] = useState('Mohon tunggu sebentar ya, Anda terlalu cepat mengirim pesan.');

  // Status Auto-restart
  const [restarting, setRestarting] = useState(false);
  
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
        if (cfg.agent?.welcomeMessage) setWelcomeMessage(cfg.agent.welcomeMessage);
        
        // Map API keys
        const keys: { [providerId: string]: string } = {};
        if (cfg.providers) {
          for (const [provId, data] of Object.entries(cfg.providers)) {
            if (data && typeof data === 'object' && (data as any).apiKey) {
              keys[provId] = (data as any).apiKey;
            }
          }
        }
        setApiKeys(keys);

        // Map toggles
        if (cfg.groupChat?.enabled !== undefined) setGroupChatEnabled(cfg.groupChat.enabled);
        if (cfg.agent?.autoReply !== undefined) setAutoReply(cfg.agent.autoReply);



        // Map Jam Kerja (Working Hours)
        if (cfg.workingHours?.enabled !== undefined) setWhEnabled(cfg.workingHours.enabled);
        if (cfg.workingHours?.start) setWhStart(cfg.workingHours.start);
        if (cfg.workingHours?.end) setWhEnd(cfg.workingHours.end);
        if (cfg.workingHours?.timezone) setWhTimezone(cfg.workingHours.timezone);
        if (cfg.workingHours?.offlineMessage) setWhOfflineMsg(cfg.workingHours.offlineMessage);

        // Map Rate Limiting
        if (cfg.rateLimit?.max !== undefined) setRlMax(cfg.rateLimit.max);
        if (cfg.rateLimit?.windowSeconds !== undefined) setRlWindow(cfg.rateLimit.windowSeconds);
        if (cfg.rateLimit?.message) setRlMsg(cfg.rateLimit.message);

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
      // Rekonstruksi providers config
      const updatedProviders = { ...rawConfig.providers };
      for (const [provId, key] of Object.entries(apiKeys)) {
        updatedProviders[provId] = {
          ...updatedProviders[provId],
          apiKey: key.trim()
        };
      }

      const updatedConfig = {
        ...rawConfig,
        model: model.trim(),
        providers: updatedProviders,
        agent: {
          ...rawConfig.agent,
          welcomeMessage: welcomeMessage.trim(),
          autoReply: autoReply
        },
        groupChat: {
          ...rawConfig.groupChat,
          enabled: groupChatEnabled
        },

        workingHours: {
          ...rawConfig.workingHours,
          enabled: whEnabled,
          start: whStart.trim(),
          end: whEnd.trim(),
          timezone: whTimezone.trim(),
          offlineMessage: whOfflineMsg.trim()
        },
        rateLimit: {
          ...rawConfig.rateLimit,
          max: Number(rlMax) || 10,
          windowSeconds: Number(rlWindow) || 10,
          message: rlMsg.trim()
        }
      };

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: updatedConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('Server mengembalikan respon error');
      }

      const resData = await response.json();
      setSaved(true);
      if (resData.restarted) {
        setRestarting(true);
        setTimeout(() => {
          setSaved(false);
          setRestarting(false);
        }, 5000);
      } else {
        alert('✓ Setelan disimpan! Silakan jalankan ulang WAGENT di terminal untuk menerapkan perubahan.');
        setTimeout(() => {
          setSaved(false);
        }, 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan konfigurasi');
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--text-subtle)', fontSize: 13 }}>Memuat pengaturan...</div>;
  }

  return (
    <div style={{
      padding: '16px 20px',
      width: '100%',
      overflowY: 'auto',
      height: '100%',
      backgroundColor: 'var(--bg-main)',
      color: 'var(--text-main)',
      boxSizing: 'border-box'
    }}>
      <div style={{ maxWidth: '100%', padding: 0 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-heading)', margin: 0 }}>Pengaturan WAGENT</h2>
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4, margin: 0 }}>
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
                <label style={{ fontSize: 12, color: 'var(--text-heading)', minWidth: 100 }}>AI Provider</label>
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
                <label style={{ fontSize: 12, color: 'var(--text-heading)', minWidth: 100 }}>Model AI</label>
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
                <label style={{ fontSize: 11, color: 'var(--text-subtle)', minWidth: 100 }}>Model ID Aktif</label>
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
              {availableProviders
                .filter(provId => provId !== 'ollama')
                .filter(provId => provId === selectedProvider || (apiKeys[provId] && apiKeys[provId].trim() !== ''))
                .map(provId => {
                  const labels: { [id: string]: string } = {
                    google: 'Google Gemini',
                    openai: 'OpenAI',
                    anthropic: 'Anthropic',
                    groq: 'Groq',
                    deepseek: 'DeepSeek',
                    mistral: 'Mistral',
                    xai: 'xAI',
                    cohere: 'Cohere',
                    together: 'Together AI',
                    fireworks: 'Fireworks AI',
                    perplexity: 'Perplexity'
                  };
                  const label = labels[provId] || provId.charAt(0).toUpperCase() + provId.slice(1);
                  return (
                    <InputRow
                      key={provId}
                      label={label}
                      value={apiKeys[provId] || ''}
                      onChange={(val) => handleApiKeyChange(provId, val)}
                      placeholder={`Kunci API ${label}`}
                      type="password"
                    />
                  );
                })}
            </div>
          </Section>

          <Section title="Rate Limiting (Anti-Spam)" description="Batasi pesan per pengguna untuk mencegah spam">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-heading)', minWidth: 100 }}>Maks. Pesan</label>
                <input
                  type="number"
                  value={rlMax}
                  onChange={(e) => setRlMax(Number(e.target.value))}
                  style={{ ...styles.input, padding: '6px 10px', fontSize: 12, width: '100%', maxWidth: 260 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-heading)', minWidth: 100 }}>Durasi (Detik)</label>
                <input
                  type="number"
                  value={rlWindow}
                  onChange={(e) => setRlWindow(Number(e.target.value))}
                  style={{ ...styles.input, padding: '6px 10px', fontSize: 12, width: '100%', maxWidth: 260 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-heading)', minWidth: 100 }}>Pesan Peringatan</label>
                <input
                  type="text"
                  value={rlMsg}
                  onChange={(e) => setRlMsg(e.target.value)}
                  style={{ ...styles.input, padding: '6px 10px', fontSize: 12, width: '100%', maxWidth: 260 }}
                />
              </div>
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

      {/* Baris Penuh: Jam Kerja */}
      <div style={{ marginBottom: 16 }}>
        <Section title="Jam Kerja (Working Hours)" description="Batasi operasional AI agar membalas sesuai jam kerja yang ditentukan">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ToggleRow
              label="Aktifkan Batasan Jam Kerja"
              description="AI hanya akan merespon pada jam operasional di bawah ini"
              checked={whEnabled}
              onChange={setWhEnabled}
            />
            
            {whEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 12, borderTop: '1px solid #222e35', paddingTop: 12, marginTop: 4 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Jam Mulai</label>
                  <input
                    type="time"
                    value={whStart}
                    onChange={(e) => setWhStart(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Jam Selesai</label>
                  <input
                    type="time"
                    value={whEnd}
                    onChange={(e) => setWhEnd(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Zona Waktu</label>
                  <select
                    value={whTimezone}
                    onChange={(e) => setWhTimezone(e.target.value)}
                    style={{ ...styles.input, cursor: 'pointer' }}
                  >
                    <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                    <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                    <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>
            )}
            
            {whEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Pesan Offline</label>
                <input
                  type="text"
                  value={whOfflineMsg}
                  onChange={(e) => setWhOfflineMsg(e.target.value)}
                  placeholder="Mohon maaf, saat ini di luar jam operasional."
                  style={styles.input}
                />
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* Restarting Overlay */}
      {restarting && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(11, 20, 26, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          color: 'var(--text-heading)'
        }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚙️</div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px 0' }}>Memuat Ulang Sistem...</h3>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0, textAlign: 'center', maxWidth: 320 }}>
            Menyimpan perubahan dan memulai ulang engine AI. Halaman akan siap kembali dalam beberapa detik.
          </p>
        </div>
      )}

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
    </div>
  );
}

// ── Helper Components ───────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-sidebar)',
      borderRadius: 10,
      border: '1px solid var(--border-color)',
      padding: '14px 16px',
      boxSizing: 'border-box'
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', margin: '0 0 2px 0' }}>{title}</h3>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px 0' }}>{description}</p>
      {children}
    </div>
  );
}

function InputRow({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <label style={{ fontSize: 12, color: 'var(--text-main)', minWidth: 100 }}>{label}</label>
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
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-main)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 18,
          borderRadius: 9,
          border: 'none',
          background: checked ? '#00a884' : 'var(--border-color)',
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
    border: '1px solid var(--border-color)',
    background: 'var(--bg-input)',
    color: 'var(--text-main)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  }
};
