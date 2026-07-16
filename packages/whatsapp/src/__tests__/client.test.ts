import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaileysAdapter } from '../client.js';

function makeAdapter(): BaileysAdapter {
  const cfg: any = {
    whatsappSessionDir: '/tmp/wagent-test-sessions',
    whatsappSessionName: 'test',
  };
  const a = new BaileysAdapter(cfg, 'test');
  (a as any)._userJid = '628123456789@s.whatsapp.net';
  return a;
}

function makeRawMessage(message: any, overrides: any = {}) {
  return {
    key: {
      remoteJid: overrides.remoteJid || '628987654321@s.whatsapp.net',
      id: overrides.id || 'msg-1',
      fromMe: overrides.fromMe ?? false,
    },
    message,
    messageTimestamp: 1700000000,
    pushName: overrides.pushName || 'Budi',
    ...overrides.extra,
  };
}

describe('BaileysAdapter.parseIncomingMessage', () => {
  let adapter: BaileysAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  describe('audio detection', () => {
    it('detects voice note (PTT) as audio type with voice placeholder', () => {
      const msg = makeRawMessage({ audioMessage: { ptt: true, mimetype: 'audio/ogg', seconds: 5 } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('audio');
      expect(parsed.content).toBe('🎤 [Pesan Suara]');
      expect(parsed.metadata.isVoiceNote).toBe(true);
      expect(parsed.fromMe).toBe(false);
    });

    it('detects regular audio (non-PTT) as audio type with audio placeholder', () => {
      const msg = makeRawMessage({ audioMessage: { ptt: false, mimetype: 'audio/mpeg' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('audio');
      expect(parsed.content).toBe('🎵 [Audio]');
      expect(parsed.metadata.isVoiceNote).toBe(false);
    });
  });

  describe('image detection', () => {
    it('detects image and uses caption when present', () => {
      const msg = makeRawMessage({ imageMessage: { caption: 'Foto produk', mimetype: 'image/jpeg' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('image');
      expect(parsed.content).toBe('Foto produk');
      expect(parsed.metadata.rawMessage).toBe(msg);
    });

    it('falls back to [Gambar] placeholder when no caption', () => {
      const msg = makeRawMessage({ imageMessage: { mimetype: 'image/jpeg' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('image');
      expect(parsed.content).toBe('[Gambar]');
    });
  });

  describe('video detection', () => {
    it('detects video and uses caption when present', () => {
      const msg = makeRawMessage({ videoMessage: { caption: 'Demo', mimetype: 'video/mp4' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('video');
      expect(parsed.content).toBe('Demo');
    });

    it('falls back to [Video] placeholder when no caption', () => {
      const msg = makeRawMessage({ videoMessage: { mimetype: 'video/mp4' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('video');
      expect(parsed.content).toBe('[Video]');
    });
  });

  describe('document detection', () => {
    it('detects document and includes filename in placeholder', () => {
      const msg = makeRawMessage({ documentMessage: { fileName: 'invoice.pdf', mimetype: 'application/pdf' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('document');
      expect(parsed.content).toBe('[Dokumen: invoice.pdf]');
    });

    it('uses caption when present for document', () => {
      const msg = makeRawMessage({ documentMessage: { fileName: 'invoice.pdf', caption: 'Tagihan', mimetype: 'application/pdf' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('document');
      expect(parsed.content).toBe('Tagihan');
    });
  });

  describe('sticker detection', () => {
    it('detects sticker with [Stiker] placeholder', () => {
      const msg = makeRawMessage({ stickerMessage: { mimetype: 'image/webp' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('sticker');
      expect(parsed.content).toBe('[Stiker]');
    });
  });

  describe('text detection', () => {
    it('detects plain conversation text', () => {
      const msg = makeRawMessage({ conversation: 'Halo' });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('text');
      expect(parsed.content).toBe('Halo');
    });

    it('detects extended text message', () => {
      const msg = makeRawMessage({ extendedTextMessage: { text: 'Info harga' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.type).toBe('text');
      expect(parsed.content).toBe('Info harga');
    });

    it('returns null for empty/unsupported message', () => {
      const msg = makeRawMessage({});
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed).toBeNull();
    });

    it('extracts mentioned JIDs for group messages', () => {
      const msg = makeRawMessage({
        extendedTextMessage: {
          text: 'hai',
          contextInfo: { mentionedJid: ['628111111111@s.whatsapp.net'] },
        },
      });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.metadata.mentionedJid).toEqual(['628111111111@s.whatsapp.net']);
    });
  });

  describe('location and contact', () => {
    it('builds location placeholder', () => {
      const msg = makeRawMessage({ locationMessage: { name: 'Toko ABC' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.content).toBe('[Lokasi: Toko ABC]');
      expect(parsed.type).toBe('text');
    });

    it('builds contact placeholder', () => {
      const msg = makeRawMessage({ contactMessage: { displayName: 'Ani' } });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.content).toBe('[Kontak: Ani]');
    });
  });

  describe('metadata', () => {
    it('sets fromMe, from, to, pushName correctly', () => {
      const msg = makeRawMessage({ conversation: 'x' }, { fromMe: true });
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed.fromMe).toBe(true);
      expect(parsed.from).toBe('628987654321@s.whatsapp.net');
      expect(parsed.to).toBe('628123456789@s.whatsapp.net');
      expect(parsed.metadata.pushName).toBe('Budi');
    });

    it('generates id when key has none', () => {
      const msg = makeRawMessage({ conversation: 'x' });
      delete msg.key.id;
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(typeof parsed.id).toBe('string');
      expect(parsed.id.length).toBeGreaterThan(0);
    });

    it('returns null when remoteJid is missing', () => {
      const msg = makeRawMessage({ conversation: 'x' });
      delete msg.key.remoteJid;
      const parsed = (adapter as any).parseIncomingMessage(msg, msg.key);
      expect(parsed).toBeNull();
    });
  });
});

describe('BaileysAdapter.isVoiceNote', () => {
  let adapter: BaileysAdapter;
  beforeEach(() => { adapter = makeAdapter(); });

  it('returns true for PTT audio', () => {
    expect(adapter.isVoiceNote({ message: { audioMessage: { ptt: true } } })).toBe(true);
  });

  it('returns false for non-PTT audio', () => {
    expect(adapter.isVoiceNote({ message: { audioMessage: { ptt: false } } })).toBe(false);
  });

  it('returns false when no audio message', () => {
    expect(adapter.isVoiceNote({ message: { conversation: 'hi' } })).toBe(false);
  });
});

describe('BaileysAdapter.downloadAudio', () => {
  let adapter: BaileysAdapter;
  beforeEach(() => { adapter = makeAdapter(); });

  it('throws when message has no audio', async () => {
    await expect(adapter.downloadAudio({ message: { conversation: 'hi' } })).rejects.toThrow('No audio message found');
  });
});

describe('BaileysAdapter.downloadImage', () => {
  let adapter: BaileysAdapter;
  beforeEach(() => { adapter = makeAdapter(); });

  it('throws when message has no image', async () => {
    await expect(adapter.downloadImage({ message: { conversation: 'hi' } })).rejects.toThrow('No image message found');
  });
});

describe('BaileysAdapter.extractMessageContent', () => {
  let adapter: BaileysAdapter;
  beforeEach(() => { adapter = makeAdapter(); });

  const ex = (msg: any) => (adapter as any).extractMessageContent(msg);

  it('returns conversation text', () => {
    expect(ex({ message: { conversation: 'halo' } })).toBe('halo');
  });

  it('returns extended text', () => {
    expect(ex({ message: { extendedTextMessage: { text: 'x' } } })).toBe('x');
  });

  it('returns image caption placeholder', () => {
    expect(ex({ message: { imageMessage: {} } })).toBe('[Gambar]');
  });

  it('returns video caption placeholder', () => {
    expect(ex({ message: { videoMessage: {} } })).toBe('[Video]');
  });

  it('returns document placeholder with filename', () => {
    expect(ex({ message: { documentMessage: { fileName: 'a.pdf' } } })).toBe('[Dokumen: a.pdf]');
  });

  it('returns sticker placeholder', () => {
    expect(ex({ message: { stickerMessage: {} } })).toBe('[Stiker]');
  });

  it('returns location placeholder', () => {
    expect(ex({ message: { locationMessage: { name: 'Y' } } })).toBe('[Lokasi: Y]');
  });

  it('returns contact placeholder', () => {
    expect(ex({ message: { contactMessage: { displayName: 'Z' } } })).toBe('[Kontak: Z]');
  });

  it('returns null for unknown', () => {
    expect(ex({ message: {} })).toBeNull();
    expect(ex({})).toBeNull();
  });
});

describe('BaileysAdapter.extractMentionedJids', () => {
  let adapter: BaileysAdapter;
  beforeEach(() => { adapter = makeAdapter(); });

  const em = (msg: any) => (adapter as any).extractMentionedJids(msg);

  it('extracts from extendedTextMessage.contextInfo', () => {
    const msg: any = { message: { extendedTextMessage: { contextInfo: { mentionedJid: ['a@x'] } } } };
    expect(em(msg)).toEqual(['a@x']);
  });

  it('returns empty array when none', () => {
    expect(em({ message: { conversation: 'hi' } })).toEqual([]);
    expect(em({})).toEqual([]);
  });
});

describe('BaileysAdapter connection getters', () => {
  it('reports disconnected before connect', () => {
    const adapter = makeAdapter();
    expect(adapter.getConnectionStatus()).toBe('disconnected');
    expect(adapter.isConnected()).toBe(false);
  });
});
