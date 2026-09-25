/**
 * Build vault path with optional interviewee subfolder (between vault root and meeting folder).
 */
export function buildEffectiveObsidianVaultPath(
  baseVault: string,
  segment?: string | null
): string {
  const base = baseVault.trim();
  if (!base) return base;

  const seg = segment?.trim();
  if (!seg) return base;

  const normalizedBase = base.replace(/[/\\]+$/, '');
  const normalizedSeg = seg.replace(/^[/\\]+|[/\\]+$/g, '');
  const separator = /\\/.test(normalizedBase) ? '\\' : '/';
  return `${normalizedBase}${separator}${normalizedSeg}`;
}
