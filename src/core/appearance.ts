/** Portable color roles. Surfaces remain neutral and dark in every preset. */
export const colorRoles = {
  accentColor: ['Interface accent', '--accent', '#9daeff'],
  secondaryAccentColor: ['Secondary accent', '--secondary-accent', '#9eabbf'],
  errorColor: ['Errors', '--error', '#e59a9a'],
  warningColor: ['Warnings', '--warning', '#d6b585'],
  cursorColor: ['Cursor', '--cursor', '#c4ceff'],
  selectionColor: ['Selection', '--selection', '#303c66'],
  syntaxCommandColor: ['Commands', '--syntax-command', '#acbbf5'],
  syntaxKeywordColor: ['Keywords', '--syntax-keyword', '#c2a9e5'],
  syntaxStringColor: ['Strings', '--syntax-string', '#a7bfa5'],
  syntaxNumberColor: ['Numbers', '--syntax-number', '#d2b18c'],
  syntaxCommentColor: ['Comments', '--syntax-comment', '#757b88'],
} as const;
export type ColorKey = keyof typeof colorRoles;
export type Colors = Record<ColorKey, string>;
export const defaultColors = Object.fromEntries(
  Object.entries(colorRoles).map(([key, role]) => [key, role[2]]),
) as Colors;
export const accentPresets = {
  Iris: {
    accentColor: '#9daeff',
    secondaryAccentColor: '#9eabbf',
    cursorColor: '#c4ceff',
    selectionColor: '#303c66',
  },
  Ice: {
    accentColor: '#8ccfd4',
    secondaryAccentColor: '#99afb9',
    cursorColor: '#bef5f7',
    selectionColor: '#25474c',
  },
  Amber: {
    accentColor: '#dbb57c',
    secondaryAccentColor: '#b6aa98',
    cursorColor: '#f7d6a5',
    selectionColor: '#51412b',
  },
  Mono: {
    accentColor: '#c5c9d0',
    secondaryAccentColor: '#9298a2',
    cursorColor: '#ffffff',
    selectionColor: '#363b44',
  },
} satisfies Record<string, Partial<Colors>>;
export function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
/** Pick the higher-contrast foreground for arbitrary user accent colors. */
export function accentForeground(hex: string): string {
  const values = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  return luminance > 0.179 ? '#090a0c' : '#ffffff';
}
