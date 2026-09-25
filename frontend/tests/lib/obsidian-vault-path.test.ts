import { describe, expect, test } from 'bun:test';
import { buildEffectiveObsidianVaultPath } from '../../src/lib/obsidian-vault-path';
import {
  sanitizeObsidianVaultSegment,
} from '../../src/lib/obsidian-interviewees';

describe('sanitizeObsidianVaultSegment', () => {
  test('keeps spaces in names', () => {
    expect(sanitizeObsidianVaultSegment('Maria Silva')).toBe('Maria Silva');
  });

  test('replaces invalid path characters', () => {
    expect(sanitizeObsidianVaultSegment('foo/bar:baz')).toBe('foo-bar-baz');
  });

  test('empty after sanitization', () => {
    expect(sanitizeObsidianVaultSegment('   ')).toBe('');
    expect(sanitizeObsidianVaultSegment('///')).toBe('');
  });
});

describe('buildEffectiveObsidianVaultPath', () => {
  test('returns base when segment missing', () => {
    expect(buildEffectiveObsidianVaultPath('C:\\Vault', null)).toBe('C:\\Vault');
    expect(buildEffectiveObsidianVaultPath('C:\\Vault\\', undefined)).toBe('C:\\Vault');
  });

  test('appends segment on Windows-style paths', () => {
    expect(buildEffectiveObsidianVaultPath('C:\\Obsidian\\Cofre', 'Maria Silva')).toBe(
      'C:\\Obsidian\\Cofre\\Maria Silva'
    );
  });

  test('appends segment on posix-style paths', () => {
    expect(buildEffectiveObsidianVaultPath('/home/vault', 'Ana')).toBe('/home/vault/Ana');
  });
});
