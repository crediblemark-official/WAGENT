import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StyleRouter } from '../utils/style-router.js';
import { ContactProfile, StyleDirective, MemoryEntry } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

vi.mock('../utils/style-descriptions.js', () => ({
  TONE_DESCRIPTIONS: {
    casual: 'santai dan natural',
    formal: 'formal dan sopan',
    professional: 'profesional dan ramah',
    friendly: 'ramah dan hangat',
    mixed: 'adaptif mengikuti lawan bicara',
  },
  EMOJI_INSTRUCTIONS: {
    rare: 'Hindari penggunaan emoji.',
    moderate: 'Gunakan emoji secukupnya.',
    frequent: 'Gunakan emoji dengan bebas.',
  },
  VALID_TONES: ['casual', 'formal', 'professional', 'friendly', 'mixed'],
}));

const mockLoadContactProfile = vi.fn();
const mockSaveContactProfile = vi.fn();
const mockListContactProfiles = vi.fn();
const mockReadRecentMemory = vi.fn();

function createMockMemoryManager() {
  return {
    loadContactProfile: mockLoadContactProfile,
    saveContactProfile: mockSaveContactProfile,
    listContactProfiles: mockListContactProfiles,
    readRecentMemory: mockReadRecentMemory,
  } as any;
}

function makeProfile(overrides?: Partial<ContactProfile>): ContactProfile {
  return {
    contactId: 'test-user@s.whatsapp.net',
    name: 'Test User',
    tone: 'friendly',
    updatedAt: new Date('2026-07-15T10:00:00Z'),
    ...overrides,
  };
}

function makeEntries(...contents: string[]): MemoryEntry[] {
  return contents.map((content) => ({
    contactId: 'test-user@s.whatsapp.net',
    role: 'user' as const,
    content,
    timestamp: new Date().toISOString(),
  }));
}

describe('StyleRouter', () => {
  let router: StyleRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new StyleRouter(createMockMemoryManager());
  });

  // ── getOrCreateProfile ────────────────────────────────────────

  describe('getOrCreateProfile', () => {
    it('should return existing profile if found', async () => {
      const profile = makeProfile({ tone: 'formal' });
      mockLoadContactProfile.mockReturnValue(profile);

      const result = await router.getOrCreateProfile('test-user@s.whatsapp.net', 'Test User');

      expect(result).toBe(profile);
      expect(mockSaveContactProfile).not.toHaveBeenCalled();
    });

    it('should create new profile with tone friendly if not found', async () => {
      mockLoadContactProfile.mockReturnValue(null);

      const result = await router.getOrCreateProfile('test-user@s.whatsapp.net', 'Test User');

      expect(result.tone).toBe('friendly');
      expect(result.contactId).toBe('test-user@s.whatsapp.net');
      expect(result.name).toBe('Test User');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should save new profile via memoryManager', async () => {
      mockLoadContactProfile.mockReturnValue(null);

      await router.getOrCreateProfile('test-user@s.whatsapp.net', 'Test User');

      expect(mockSaveContactProfile).toHaveBeenCalledTimes(1);
      const saved = mockSaveContactProfile.mock.calls[0][0] as ContactProfile;
      expect(saved.contactId).toBe('test-user@s.whatsapp.net');
      expect(saved.tone).toBe('friendly');
    });
  });

  // ── detectContextType ─────────────────────────────────────────

  describe('detectContextType', () => {
    it('should return unknown for empty entries', () => {
      mockReadRecentMemory.mockReturnValue([]);

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('unknown');
    });

    it('should return urgent for urgent messages', () => {
      mockReadRecentMemory.mockReturnValue(makeEntries('urgent! tolong segera error'));

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('urgent');
    });

    it('should return business for business messages with score >= 2', () => {
      mockReadRecentMemory.mockReturnValue(
        makeEntries('harga berapa?', 'mau pesan barang', 'ongkir berapa')
      );

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('business');
    });

    it('should return casual for casual messages', () => {
      mockReadRecentMemory.mockReturnValue(
        makeEntries('halo hai', 'gimana kabar')
      );

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('casual');
    });

    it('should return unknown for neutral messages', () => {
      mockReadRecentMemory.mockReturnValue(
        makeEntries('ok', 'thanks', 'understood')
      );

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('unknown');
    });

    it('should prioritize urgent over business', () => {
      mockReadRecentMemory.mockReturnValue(
        makeEntries('urgent! error parah', 'harga berapa? mau order')
      );

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('urgent');
    });

    it('should prioritize business over casual', () => {
      mockReadRecentMemory.mockReturnValue(
        makeEntries('halo hai', 'harga berapa?', 'mau order barang')
      );

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('business');
    });

    it('should return unknown when readRecentMemory throws', () => {
      mockReadRecentMemory.mockImplementation(() => {
        throw new Error('disk error');
      });

      const result = router.detectContextType('test-user@s.whatsapp.net');

      expect(result).toBe('unknown');
    });
  });

  // ── getStyleDirective ─────────────────────────────────────────

  describe('getStyleDirective', () => {
    it('should return default directive when no profile exists', async () => {
      mockLoadContactProfile.mockReturnValue(null);

      const result = await router.getStyleDirective('test-user@s.whatsapp.net', 'Test User');

      expect(result.tone).toBe('friendly');
      expect(result.styleInstructions).toContain('ramah dan profesional');
      expect(result.examples).toEqual([]);
    });

    it('should return profile-based directive when profile exists', async () => {
      const profile = makeProfile({ tone: 'formal' });
      mockLoadContactProfile.mockReturnValue(profile);

      const result = await router.getStyleDirective('test-user@s.whatsapp.net', 'Test User');

      expect(result.tone).toBe('formal');
      expect(result.styleInstructions).toContain('formal dan sopan');
    });

    it('should return default directive with urgent context', async () => {
      mockLoadContactProfile.mockReturnValue(null);

      const result = await router.getStyleDirective(
        'test-user@s.whatsapp.net',
        'Test User',
        'urgent'
      );

      expect(result.tone).toBe('friendly');
      expect(result.styleInstructions).toContain('URGEN');
      expect(result.styleInstructions).toContain('langsung');
    });

    it('should return default directive with business context', async () => {
      mockLoadContactProfile.mockReturnValue(null);

      const result = await router.getStyleDirective(
        'test-user@s.whatsapp.net',
        'Test User',
        'business'
      );

      expect(result.tone).toBe('friendly');
      expect(result.styleInstructions).toContain('BISNIS');
      expect(result.styleInstructions).toContain('profesional');
    });
  });

  // ── profileToDirective ────────────────────────────────────────

  describe('profileToDirective', () => {
    it('should include tone description in instructions', () => {
      const profile = makeProfile({ tone: 'casual' });

      const result = router.profileToDirective(profile);

      expect(result.tone).toBe('casual');
      expect(result.styleInstructions).toContain('santai dan natural');
    });

    it('should include urgent context when contextType is urgent', () => {
      const profile = makeProfile({ tone: 'friendly' });

      const result = router.profileToDirective(profile, 'urgent');

      expect(result.styleInstructions).toContain('URGEN');
      expect(result.styleInstructions).toContain('Hindari basa-basi');
    });

    it('should include business context when contextType is business', () => {
      const profile = makeProfile({ tone: 'professional' });

      const result = router.profileToDirective(profile, 'business');

      expect(result.styleInstructions).toContain('BISNIS');
      expect(result.styleInstructions).toContain('terstruktur');
    });

    it('should include language, greetings, and emoji usage', () => {
      const profile = makeProfile({
        language: 'Indonesia campur Inggris',
        greetings: ['Bro', 'Brod'],
        emojiUsage: 'moderate',
      });

      const result = router.profileToDirective(profile);

      expect(result.styleInstructions).toContain('Indonesia campur Inggris');
      expect(result.styleInstructions).toContain('Bro');
      expect(result.styleInstructions).toContain('Brod');
      expect(result.styleInstructions).toContain('Gunakan emoji secukupnya');
    });
  });

  // ── updateProfileFromInteraction ──────────────────────────────

  describe('updateProfileFromInteraction', () => {
    it('should update tone when valid tone provided', async () => {
      const existing = makeProfile({ tone: 'friendly' });
      mockLoadContactProfile.mockReturnValue(existing);

      await router.updateProfileFromInteraction(
        'test-user@s.whatsapp.net',
        'Test User',
        'formal'
      );

      expect(mockSaveContactProfile).toHaveBeenCalledTimes(1);
      const saved = mockSaveContactProfile.mock.calls[0][0] as ContactProfile;
      expect(saved.tone).toBe('formal');
    });

    it('should ignore invalid tone', async () => {
      const existing = makeProfile({ tone: 'casual' });
      mockLoadContactProfile.mockReturnValue(existing);

      await router.updateProfileFromInteraction(
        'test-user@s.whatsapp.net',
        'Test User',
        'invalid-tone'
      );

      expect(mockSaveContactProfile).toHaveBeenCalledTimes(1);
      const saved = mockSaveContactProfile.mock.calls[0][0] as ContactProfile;
      expect(saved.tone).toBe('casual');
    });

    it('should update language', async () => {
      const existing = makeProfile({ tone: 'friendly' });
      mockLoadContactProfile.mockReturnValue(existing);

      await router.updateProfileFromInteraction(
        'test-user@s.whatsapp.net',
        'Test User',
        undefined,
        'English'
      );

      expect(mockSaveContactProfile).toHaveBeenCalledTimes(1);
      const saved = mockSaveContactProfile.mock.calls[0][0] as ContactProfile;
      expect(saved.language).toBe('English');
    });
  });

  // ── listAllStyles ─────────────────────────────────────────────

  describe('listAllStyles', () => {
    it('should return empty array when no profiles exist', () => {
      mockListContactProfiles.mockReturnValue([]);

      const result = router.listAllStyles();

      expect(result).toEqual([]);
      expect(mockLoadContactProfile).not.toHaveBeenCalled();
    });

    it('should return list of all styles', () => {
      const profiles = [
        { contactId: 'alice@s.whatsapp.net', name: 'Alice' },
        { contactId: 'bob@s.whatsapp.net', name: 'Bob' },
      ];
      mockListContactProfiles.mockReturnValue(profiles);
      mockLoadContactProfile
        .mockReturnValueOnce(makeProfile({ contactId: 'alice@s.whatsapp.net', name: 'Alice', tone: 'formal' }))
        .mockReturnValueOnce(makeProfile({ contactId: 'bob@s.whatsapp.net', name: 'Bob', tone: 'casual' }));

      const result = router.listAllStyles();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ contactId: 'alice@s.whatsapp.net', name: 'Alice', tone: 'formal' });
      expect(result[1]).toEqual({ contactId: 'bob@s.whatsapp.net', name: 'Bob', tone: 'casual' });
    });

    it('should handle missing profile gracefully', () => {
      const profiles = [
        { contactId: 'alice@s.whatsapp.net', name: 'Alice' },
      ];
      mockListContactProfiles.mockReturnValue(profiles);
      mockLoadContactProfile.mockReturnValue(null);

      const result = router.listAllStyles();

      expect(result).toHaveLength(1);
      expect(result[0].tone).toBe('unknown');
    });
  });
});
