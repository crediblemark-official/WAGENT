import React, { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks';

interface NumberInfo {
  id: string; sessionName: string; label: string;
  status: string; userJid?: string;
}

const statusColors: Record<string, string> = {
  connected: '#22c55e', connecting: '#eab308', qr: '#a855f7',
  disconnected: '#ef4444', reconnecting: '#f97316',
};
const statusLabels: Record<string, string> = {
  connected: 'Terkoneksi', connecting: 'Menghubungkan', qr: 'Scan QR',
  disconnected: 'Terputus', reconnecting: 'Menghubungkan ulang',
};

export function NumbersPage({ ws }: { ws: ReturnType<typeof useWebSocket> }) {
  const [activeTab, setActiveTab] = useState<'whatsapp' | 'telegram'>('whatsapp');
  const [numbers, setNumbers] = useState<NumberInfo[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ id: '', sessionName: '', label: '' });
  const [qrCodes, setQrCodes] = useState<{ [numberId: string]: string }>({});

  // Telegram Config States
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgSaved, setTgSaved] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgTestError, setTgTestError] = useState<string | null>(null);
  const [tgTestSuccess, setTgTestSuccess] = useState<boolean | null>(null);
  const [rawConfig, setRawConfig] = useState<any>(null);

  // Auto-Detect States
  const [tgBinding, setTgBinding] = useState(false);
  const [tgVerificationCode, setTgVerificationCode] = useState<string | null>(null);
  const [tgPollInterval, setTgPollInterval] = useState<any>(null);
  const [tgTimeLeft, setTgTimeLeft] = useState(60);
  const [tgDetectName, setTgDetectName] = useState<string | null>(null);

  useEffect(() => {
    ws.send({ type: 'get:numbers' });
    const unsubList = ws.on('numbers:list', (d) => {
      if (d.numbers) {
        setNumbers(d.numbers);
        const initialQrs: { [id: string]: string } = {};
        for (const n of d.numbers) {
          if (n.status === 'qr' && (n as any).qrCode) {
            initialQrs[n.id] = (n as any).qrCode;
          }
        }
        setQrCodes(prev => ({ ...prev, ...initialQrs }));
      }
    });
    const unsubUpdate = ws.on('number:update', (d) => {
      if (!d.number) return;
      setNumbers(prev => {
        const idx = prev.findIndex(n => n.id === d.number.id);
        if (idx >= 0) { const u = [...prev]; u[idx] = d.number; return u; }
        return [...prev, d.number];
      });
    });
    const unsubQr = ws.on('qr:received', (d) => {
      if (d.qr && d.numberId) {
        setQrCodes(prev => ({ ...prev, [d.numberId]: d.qr }));
      }
    });
    const unsubStatus = ws.on('connection:update', (d) => {
      if (d.status && d.numberId) {
        setNumbers(prev => {
          return prev.map(n => {
            if (n.id === d.numberId) {
              return { ...n, status: d.status };
            }
            return n;
          });
        });
      }
    });
    return () => { unsubList(); unsubUpdate(); unsubQr(); unsubStatus(); };
  }, [ws]);

  useEffect(() => {
    // Memuat konfigurasi eskalasi Telegram
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.config) {
          setRawConfig(data.config);
          if (data.config.escalation?.telegramBotToken) {
            setTgBotToken(data.config.escalation.telegramBotToken);
          }
          if (data.config.escalation?.telegramChatId) {
            setTgChatId(data.config.escalation.telegramChatId);
          }
        }
      })
      .catch(err => console.error('Gagal memuat pengaturan:', err));
  }, []);

  const handleSaveTelegram = async () => {
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            ...rawConfig,
            escalation: {
              ...rawConfig?.escalation,
              telegramBotToken: tgBotToken.trim(),
              telegramChatId: tgChatId.trim(),
            }
          }
        }),
      });

      if (!response.ok) throw new Error('Gagal menyimpan setelan Telegram');

      const data = await response.json();
      if (data.config) {
        setRawConfig(data.config);
      }

      setTgSaved(true);
      setTimeout(() => setTgSaved(false), 3000);

      if (!data.restarted) {
        alert('✓ Setelan disimpan! Silakan jalankan ulang WAGENT di terminal untuk menerapkan perubahan.');
      }
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan setelan Telegram');
    }
  };

  const handleTestTelegram = async () => {
    setTgTesting(true);
    setTgTestError(null);
    setTgTestSuccess(null);
    try {
      const response = await fetch('/api/escalation/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tgBotToken.trim(),
          chatId: tgChatId.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Gagal mengirim pesan uji coba');
      }

      setTgTestSuccess(true);
      setTimeout(() => setTgTestSuccess(null), 5000);
    } catch (err: any) {
      setTgTestError(err.message || 'Gagal menguji bot Telegram');
    } finally {
      setTgTesting(false);
    }
  };

  const handleAutoDetectChatId = async () => {
    if (!tgBotToken) {
      alert('Masukkan Token Bot terlebih dahulu!');
      return;
    }
    setTgBinding(true);
    setTgTestError(null);
    setTgTestSuccess(null);
    setTgDetectName(null);
    setTgVerificationCode(null);
    try {
      const response = await fetch('/api/escalation/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: tgBotToken.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal memulai binding');

      setTgVerificationCode(data.code);
      setTgTimeLeft(60);

      // Polling logic
      let currentOffset = data.offset;
      const deadline = Date.now() + 60000;

      const interval = setInterval(async () => {
        const remaining = Math.round((deadline - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(interval);
          setTgVerificationCode(null);
          setTgPollInterval(null);
          setTgTestError('Waktu deteksi habis. Silakan coba lagi.');
          return;
        }
        setTgTimeLeft(remaining);

        try {
          const pollRes = await fetch('/api/escalation/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              botToken: tgBotToken.trim(),
              code: data.code,
              offset: currentOffset,
            }),
          });
          const pollData = await pollRes.json();
          if (pollData.offset) currentOffset = pollData.offset;

          if (pollData.found && pollData.chatId) {
            clearInterval(interval);
            setTgChatId(pollData.chatId);
            setTgDetectName(pollData.chatName);
            setTgVerificationCode(null);
            setTgPollInterval(null);
            setTgTestSuccess(true);
            setTimeout(() => setTgTestSuccess(null), 5000);
          }
        } catch { /* retry silently */ }
      }, 2000);

      setTgPollInterval(interval);
    } catch (err: any) {
      setTgTestError(err.message || 'Gagal mendeteksi Chat ID');
    } finally {
      setTgBinding(false);
    }
  };

  useEffect(() => {
    return () => {
      if (tgPollInterval) clearInterval(tgPollInterval);
    };
  }, [tgPollInterval]);

  const handleAdd = () => {
    if (!form.id || !form.sessionName) return;
    ws.send({ type: 'number:add', number: { ...form, enabled: true } });
    setShowAdd(false);
    setForm({ id: '', sessionName: '', label: '' });
  };

  const handleConnect = (id: string) => ws.send({ type: 'number:connect', id });
  const handleDisconnect = (id: string) => ws.send({ type: 'number:disconnect', id });
  const handleRemove = (id: string) => ws.send({ type: 'number:remove', id });

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      
      {/* Tabs Layout */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: 20 }}>
        <button 
          onClick={() => setActiveTab('whatsapp')}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            color: activeTab === 'whatsapp' ? 'var(--text-active)' : 'var(--text-muted)',
            borderBottom: activeTab === 'whatsapp' ? '3px solid var(--text-active)' : '3px solid transparent',
            marginBottom: -2,
            transition: 'all 0.15s ease',
          }}
        >
          WhatsApp Setup
        </button>
        <button 
          onClick={() => setActiveTab('telegram')}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            color: activeTab === 'telegram' ? 'var(--text-active)' : 'var(--text-muted)',
            borderBottom: activeTab === 'telegram' ? '3px solid var(--text-active)' : '3px solid transparent',
            marginBottom: -2,
            transition: 'all 0.15s ease',
          }}
        >
          Telegram Escalation
        </button>
      </div>

      {activeTab === 'whatsapp' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Nomor WhatsApp</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, margin: 0 }}>
                Kelola beberapa nomor WhatsApp dalam satu instance
              </p>
            </div>
            <button onClick={() => setShowAdd(!showAdd)} style={{
              padding: '8px 16px', borderRadius: 20, border: 'none',
              background: showAdd ? '#ef4444' : 'var(--text-active)', color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {showAdd ? 'Batal' : '+ Tambah Nomor'}
            </button>
          </div>

          {showAdd && (
            <div style={{ background: 'var(--bg-sidebar)', borderRadius: 12, border: '1px solid var(--border-color)', padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>ID</label>
                  <input value={form.id} onChange={e => setForm(f => ({...f, id: e.target.value}))} placeholder="my-number-1" style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>Session Name</label>
                  <input value={form.sessionName} onChange={e => setForm(f => ({...f, sessionName: e.target.value}))} placeholder="session-nomor-1" style={inputS} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>Label</label>
                  <input value={form.label} onChange={e => setForm(f => ({...f, label: e.target.value}))} placeholder="Nomor CS 1" style={inputS} />
                </div>
              </div>
              <button onClick={handleAdd} disabled={!form.id || !form.sessionName} style={{
                padding: '8px 20px', borderRadius: 20, border: 'none', alignSelf: 'flex-end',
                background: 'var(--text-active)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                opacity: !form.id || !form.sessionName ? 0.5 : 1,
              }}>Tambah & Connect</button>
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {numbers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
                <p>Belum ada nomor. Tambah nomor WhatsApp pertama!</p>
              </div>
            ) : numbers.map(n => (
              <div key={n.id} style={{ background: 'var(--bg-sidebar)', borderRadius: 10, border: '1px solid var(--border-color)', padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #008069, #25d366)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#fff' }}>
                      {n.label.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-main)' }}>{n.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.sessionName} {n.userJid ? `· ${n.userJid}` : ''}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: statusColors[n.status] || 'var(--text-subtle)' }} />
                      <span style={{ fontSize: 12, color: statusColors[n.status] || 'var(--text-muted)' }}>{statusLabels[n.status] || n.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {n.status !== 'connected' ? (
                        <button onClick={() => handleConnect(n.id)} style={btnS} title="Connect">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                      ) : (
                        <button onClick={() => handleDisconnect(n.id)} style={btnS} title="Disconnect">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                        </button>
                      )}
                      <button onClick={() => handleRemove(n.id)} style={btnS} title="Remove">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tampilan QR Code ketika status adalah 'qr' */}
                {n.status === 'qr' && qrCodes[n.id] && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border-color)', paddingTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-active)', fontWeight: 600 }}>Pindai Kode QR WhatsApp</div>
                    <div style={{ background: '#fff', padding: 12, borderRadius: 8, display: 'inline-block', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrCodes[n.id])}`}
                        alt="WhatsApp QR Code"
                        style={{ display: 'block', width: 180, height: 180 }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 360, lineHeight: 1.4 }}>
                      Buka aplikasi WhatsApp di HP Anda &rarr; ketuk <b>Setelan / Menu</b> &rarr; <b>Perangkat Tertaut</b> &rarr; <b>Tautkan Perangkat</b>, lalu arahkan kamera ke kode QR di atas.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', margin: '0 0 4px 0' }}>Setelan Eskalasi Telegram</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Konfigurasi penerusan notifikasi bantuan manusia ke bot Telegram ketika AI tidak mampu menjawab pesan.
            </p>
          </div>

          {tgSaved && (
            <div style={{
              padding: 10, borderRadius: 6, background: 'rgba(37, 211, 102, 0.1)',
              color: '#25d366', border: '1px solid rgba(37, 211, 102, 0.2)',
              fontSize: 12, marginBottom: 14
            }}>
              ✓ Setelan Telegram berhasil disimpan! Sistem memuat ulang latar belakang...
            </div>
          )}

          {tgTestSuccess && (
            <div style={{
              padding: 10, borderRadius: 6, background: 'rgba(37, 211, 102, 0.1)',
              color: '#25d366', border: '1px solid rgba(37, 211, 102, 0.2)',
              fontSize: 12, marginBottom: 14
            }}>
              ✓ Pesan uji coba berhasil dikirim! Silakan periksa grup/chat Telegram Anda.
            </div>
          )}

          {tgTestError && (
            <div style={{
              padding: 10, borderRadius: 6, background: 'rgba(239, 68, 68, 0.1)',
              color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)',
              fontSize: 12, marginBottom: 14
            }}>
              ⚠️ {tgTestError}
            </div>
          )}

          <div style={{
            background: 'var(--bg-sidebar)',
            borderRadius: 10,
            border: '1px solid var(--border-color)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-main)', fontWeight: 500 }}>Bot Token</label>
                  <button
                    onClick={handleAutoDetectChatId}
                    disabled={!tgBotToken || tgPollInterval !== null || tgBinding}
                    style={{
                      border: 'none', background: 'transparent', color: 'var(--text-active)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
                      opacity: !tgBotToken || tgPollInterval !== null || tgBinding ? 0.5 : 1,
                    }}
                    type="button"
                  >
                    {tgBinding ? '⏳ Menghubungkan...' : '🔗 Deteksi Otomatis (Binding)'}
                  </button>
                </div>
                <input
                  type="password"
                  value={tgBotToken}
                  onChange={e => setTgBotToken(e.target.value)}
                  placeholder="Token Bot Telegram"
                  style={{ ...inputS, background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                />
              </div>

              {tgChatId && !tgDetectName && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#00a884' }}></span>
                  ID Chat Telegram Aktif: <strong style={{ color: 'var(--text-main)' }}>{tgChatId}</strong>
                </div>
              )}
            </div>

            {tgVerificationCode && (
              <div style={{
                background: 'var(--bg-main)', padding: 14, borderRadius: 8,
                border: '1px dashed var(--text-active)', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 8, marginTop: 4
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Kirim kode verifikasi berikut ke bot Telegram Anda (bisa di chat pribadi atau di grup):
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 700, letterSpacing: 1, color: 'var(--text-main)',
                  background: 'var(--bg-input)', padding: '6px 16px', borderRadius: 4,
                  border: '1px solid var(--border-color)'
                }}>
                  {tgVerificationCode}
                </div>
                <div style={{ fontSize: 11, color: '#eab308' }}>
                  ⏳ Menunggu pesan verifikasi... (Waktu Tersisa: {tgTimeLeft} detik)
                </div>
              </div>
            )}

            {tgDetectName && (
              <div style={{ fontSize: 12, color: '#25d366', fontWeight: 500, textAlign: 'center', marginTop: 4 }}>
                ✓ Terdeteksi Chat: <b>{tgDetectName}</b> (ID: {tgChatId})
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <button
                onClick={handleTestTelegram}
                disabled={!tgBotToken || !tgChatId || tgTesting}
                style={{
                  padding: '8px 16px',
                  borderRadius: 20,
                  border: '1px solid var(--text-active)',
                  background: 'transparent',
                  color: 'var(--text-active)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: !tgBotToken || !tgChatId || tgTesting ? 0.5 : 1,
                }}
              >
                {tgTesting ? 'Menguji...' : 'Uji Coba Kirim Notifikasi'}
              </button>

              <button
                onClick={handleSaveTelegram}
                style={{
                  padding: '10px 24px',
                  borderRadius: 20,
                  border: 'none',
                  background: 'var(--text-active)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }}
              >
                Simpan Setelan Telegram
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputS: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-color)',
  background: 'var(--bg-input)', color: 'var(--text-main)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const btnS: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 6, border: 'none',
  background: 'transparent', cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};
