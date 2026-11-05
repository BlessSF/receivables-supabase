// Per-account branding: the logo at the top of the sidebar, the browser-tab
// icon and the tab title change depending on who is logged in.
//
// To give another account its own logo, add it to CUSTOM_BRANDS below
// (put the image in the /public folder).

// The name of this deployment. Each Vercel project can set its own with two Environment Variables
// (Settings -> Environment Variables), then redeploy:  VITE_BRAND_NAME = Project DCM   and   VITE_BRAND_MARK = DCM
// Nothing set = "Project DLC".
const BRAND_NAME = String(import.meta.env.VITE_BRAND_NAME || '').trim() || 'Project DLC';
const BRAND_MARK = String(import.meta.env.VITE_BRAND_MARK || '').trim().slice(0, 4).toUpperCase() || 'DL';

const CUSTOM_BRANDS = {
  demic: {
    name: BRAND_NAME,
    mark: BRAND_MARK, // letters shown in the small badge next to the name
    logo: null, // no logo image
    color: '#0a1fd8',
  },
};

const DEFAULT_COLOR = '#12756a';

export function getBranding(user) {
  const key = String(user?.username || '').toLowerCase();
  const custom = CUSTOM_BRANDS[key];
  const displayName = user?.full_name || user?.username || '';
  const initial = (displayName.trim().charAt(0) || 'M').toUpperCase();
  // Everyone on the main system (admin, accounting, executive, staff) sees the same name; branch accounts keep their own
  if (user && user.role && user.role !== 'branch') {
    return { name: BRAND_NAME, mark: BRAND_MARK, logo: null, color: '#0a1fd8', initial: BRAND_MARK, displayName };
  }
  if (custom) return { ...custom, initial: custom.mark || initial, displayName };
  return { name: 'Multipliers', logo: null, color: DEFAULT_COLOR, initial, displayName };
}

function letterIcon(letter, color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${color}"/>` +
    `<text x="32" y="45" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" ` +
    `font-size="${String(letter).length > 2 ? 26 : 38}" font-weight="600" fill="#fff">${letter}</text></svg>`;
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
    document.title = 'Receivables';
    return;
  }
  link.type = 'image/svg+xml';
  link.href = letterIcon(brand.initial, brand.color);
  document.title = `${brand.name} · Receivables`;
}