// Per-account branding: the logo at the top of the sidebar, the browser-tab
// icon and the tab title change depending on who is logged in.
//
// To give another account its own logo, add it to CUSTOM_BRANDS below
// (put the image in the /public folder).

const CUSTOM_BRANDS = {
  demic: {
    name: 'Demic Lab',
    logo: '/demic-logo.png',
    color: '#0a1fd8',
  },
};

const DEFAULT_COLOR = '#12756a';

export function getBranding(user) {
  const key = String(user?.username || '').toLowerCase();
  const custom = CUSTOM_BRANDS[key];
  const displayName = user?.full_name || user?.username || '';
  const initial = (displayName.trim().charAt(0) || 'M').toUpperCase();
  if (custom) return { ...custom, initial, displayName };
  return { name: 'Multipliers', logo: null, color: DEFAULT_COLOR, initial, displayName };
}

function letterIcon(letter, color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${color}"/>` +
    `<text x="32" y="45" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" ` +
    `font-size="38" font-weight="600" fill="#fff">${letter}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Updates the browser-tab icon + title. Pass null to reset (logged out). */
export function applyTabBranding(brand) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (!brand) {
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
    document.title = 'Multipliers Receivables';
    return;
  }
  link.type = 'image/svg+xml';
  link.href = letterIcon(brand.initial, brand.color);
  document.title = `${brand.name} · Receivables`;
}