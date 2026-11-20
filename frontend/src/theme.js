// Sidebar colours chosen in Settings > Theme. theme = { sidebar: '#rrggbb', accent: '#rrggbb' } (either may be missing = default).
export const HEX = /^#[0-9a-f]{6}$/i;
export const DEFAULT_SIDEBAR = '#0e182b';
export const DEFAULT_ACCENT = '#2fb9a3';

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
/** 'light' when the colour is bright enough that the sidebar text must turn dark. */
export const toneOf = (hex) => (HEX.test(hex || '') && lum(hex) > 0.42 ? 'light' : 'dark');

/** { style, tone } to put on the sidebar (or a preview). Empty style = the built-in look. */
export function themeProps(theme) {
  const style = {};
  const sb = HEX.test(theme?.sidebar || '') ? theme.sidebar : '';
  const ac = HEX.test(theme?.accent || '') ? theme.accent : '';
  if (sb) style['--sb-bg'] = sb;
  if (ac) style['--sb-accent'] = ac;
  return { style, tone: toneOf(sb || DEFAULT_SIDEBAR) };
}