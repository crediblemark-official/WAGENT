import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StyleRouter } from './style-router.js';
import { MemoryManager } from './memory-manager.js';
import { ContactProfile } from './types.js';

describe('StyleRouter', () => {
  let sr: StyleRouter;
  let mm: MemoryManager;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wagent-style-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mm = new MemoryManager(testDir);
    sr = new StyleRouter(mm);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  // ── Profile Management ──────────────────────────────────────

  describe('getOrCreateProfile', () => {
    it('should create default profile for new contact', async () => {
      const profile = await sr.getOrCreateProfile('budi@s.whatsapp.net', 'Budi');
      expect(profile.contactId).toBe('budi@s.whatsapp.net');
      expect(profile.name).toBe('Budi');
      expect(profile.tone).toBe('friendly');
    });

    it('should return existing profile', async () => {
      const customProfile: ContactProfile = {
        contactId: 'budi@s.whatsapp.net',
        name: 'Budi Santoso',
        tone: 'casual',
        relationship: 'Teman',
        updatedAt: new Date(),
      };
      mm.saveContactProfile(customProfile);

      const profile = await sr.getOrCreateProfile('budi@s.whatsapp.net', 'Budi');
      expect(profile.name).toBe('Budi Santoso');
      expect(profile.tone).toBe('casual');
      expect(profile.relationship).toBe('Teman');
    });

    it('should persist saved profiles', async () => {
      await sr.getOrCreateProfile('test@s.whatsapp.net', 'Test User');
      const loaded = mm.loadContactProfile('test@s.whatsapp.net');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Test User');
    });
  });

  // ── Style Directives ────────────────────────────────────────

  describe('getStyleDirective', () => {
    it('should return default directive for unknown contact', async () => {
      const directive = await sr.getStyleDirective('unknown@s.whatsapp.net', 'Unknown');
      expect(directive.tone).toBe('friendly');
      expect(directive.styleInstructions).toContain('ramah');
      expect(directive.examples).toEqual([]);
    });

    it('should return profile-based directive', async () => {
      const profile: ContactProfile = {
        contactId: 'budi@s.whatsapp.net',
        name: 'Budi',
        tone: 'casual',
        language: 'Indonesia campur Inggris',
        greetings: ['Bro'],
        emojiUsage: 'rare',
        exampleResponses: ['Oke bro gas aja'],
        updatedAt: new Date(),
      };
      mm.saveContactProfile(profile);

      const directive = await sr.getStyleDirective('budi@s.whatsapp.net', 'Budi');
      expect(directive.tone).toBe('casual');
      expect(directive.styleInstructions).toContain('santai');
      expect(directive.examples).toContain('Oke bro gas aja');
    });

    it('should give emoji instruction for frequent users', async () => {
      const profile: ContactProfile = {
        contactId: 'ekspresif@s.whatsapp.net',
        name: 'Ekspresif',
        tone: 'friendly',
        emojiUsage: 'frequent',
        updatedAt: new Date(),
      };
      mm.saveContactProfile(profile);

      const directive = await sr.getStyleDirective('ekspresif@s.whatsapp.net', 'Ekspresif');
      expect(directive.styleInstructions).toContain('gunakan emoji');
    });

    it('should give greeting instructions', async () => {
      const profile: ContactProfile = {
        contactId: 'formal@s.whatsapp.net',
        name: 'Pak Formal',
        tone: 'formal',
        greetings: ['Selamat pagi', 'Selamat siang'],
        updatedAt: new Date(),
      };
      mm.saveContactProfile(profile);

      const directive = await sr.getStyleDirective('formal@s.whatsapp.net', 'Pak Formal');
      expect(directive.styleInstructions).toContain('Selamat pagi');
    });
  });

  // ── Profile Updates ─────────────────────────────────────────

  describe('updateProfileFromInteraction', () => {
    it('should update tone for existing profile', async () => {
      await sr.getOrCreateProfile('budi@s.whatsapp.net', 'Budi');
      await sr.updateProfileFromInteraction('budi@s.whatsapp.net', 'Budi', 'formal');

      const profile = mm.loadContactProfile('budi@s.whatsapp.net');
      expect(profile!.tone).toBe('formal');
    });

    it('should create profile if none exists during update', async () => {
      await sr.updateProfileFromInteraction('new@s.whatsapp.net', 'New User', 'casual', 'English');

      const profile = mm.loadContactProfile('new@s.whatsapp.net');
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('New User');
      expect(profile!.tone).toBe('casual');
      expect(profile!.language).toBe('English');
    });

    it('should update language', async () => {
      await sr.getOrCreateProfile('bilingual@s.whatsapp.net', 'Bilingual');
      await sr.updateProfileFromInteraction('bilingual@s.whatsapp.net', 'Bilingual', undefined, 'English');

      const profile = mm.loadContactProfile('bilingual@s.whatsapp.net');
      expect(profile!.language).toBe('English');
    });

    it('should update updatedAt timestamp', async () => {
      await sr.getOrCreateProfile('user@s.whatsapp.net', 'User');
      const before = mm.loadContactProfile('user@s.whatsapp.net')!.updatedAt;

      await new Promise(r => setTimeout(r, 10)); // Ensure time passes
      await sr.updateProfileFromInteraction('user@s.whatsapp.net', 'User', 'formal');

      const after = mm.loadContactProfile('user@s.whatsapp.net')!.updatedAt;
      expect(after).not.toBe(before);
    });
  });

  // ── List Styles ─────────────────────────────────────────────

  describe('listAllStyles', () => {
    it('should return empty list when no profiles', () => {
      const list = sr.listAllStyles();
      expect(list).toEqual([]);
    });

    it('should return all profiles with tone info', async () => {
      await sr.getOrCreateProfile('a@s.whatsapp.net', 'A');
      await sr.getOrCreateProfile('b@s.whatsapp.net', 'B');

      const list = sr.listAllStyles();
      expect(list.length).toBe(2);
      expect(list.some(s => s.name === 'A')).toBe(true);
      expect(list.some(s => s.name === 'B')).toBe(true);
      expect(list.every(s => Boolean(s.tone))).toBe(true);
    });
  });

  // ── Profile to Directive Conversion ─────────────────────────

  describe('profileToDirective', () => {
    it('should convert casual profile correctly', () => {
      const profile: ContactProfile = {
        contactId: 'c@s.whatsapp.net',
        name: 'Casual',
        tone: 'casual',
        language: 'Sunda',
        greetings: ['Aku'],
        updatedAt: new Date(),
      };
      const directive = sr.profileToDirective(profile);

      expect(directive.tone).toBe('casual');
      expect(directive.styleInstructions).toContain('santai');
      expect(directive.styleInstructions).toContain('Sunda');
      expect(directive.styleInstructions).toContain('Aku');
    });

    it('should convert professional profile correctly', () => {
      const profile: ContactProfile = {
        contactId: 'p@s.whatsapp.net',
        name: 'Professional',
        tone: 'professional',
        updatedAt: new Date(),
      };
      const directive = sr.profileToDirective(profile);

      expect(directive.tone).toBe('professional');
      expect(directive.styleInstructions).toContain('profesional');
    });
  });
});
