const BASE = '/api.php';

async function call(action, { method = 'GET', params = {}, body } = {}) {
  let url = `${BASE}?action=${encodeURIComponent(action)}`;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    }
  }

  const opts = { method, credentials: 'include' };
  if (method === 'POST') {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ action, ...(body || {}) });
  }

  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned an unreadable response (status ${res.status}).`);
  }
  if (!data.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }
  return data;
}

export const api = {
  // auth
  login: (username, password) => call('login', { method: 'POST', body: { username, password } }),
  logout: () => call('logout', { method: 'POST' }),
  me: () => call('me'),

  // dashboard / summary
  getDashboard: () => call('get_dashboard'),
  getSummary: (params) => call('get_summary', { params }),

  // companies
  getCompanies: () => call('get_companies'),
  getCompany: (id) => call('get_company', { params: { id } }),
  createCompany: (body) => call('create_company', { method: 'POST', body }),
  updateCompany: (body) => call('update_company', { method: 'POST', body }),
  deleteCompany: (id) => call('delete_company', { method: 'POST', body: { id } }),
  updateCompanyStatus: (id, status) => call('update_company_status', { method: 'POST', body: { id, status } }),
  getBranches: () => call('get_branches'),

  // ledger
  getLedger: (companyId) => call('get_ledger', { params: { company_id: companyId } }),
  quickAddLedger: (companyId) => call('quick_add_ledger', { method: 'POST', body: { company_id: companyId } }),
  inlineUpdateLedger: (id, field, value) => call('inline_update_ledger', { method: 'POST', body: { id, field, value } }),
  deleteLedger: (id) => call('delete_ledger', { method: 'POST', body: { id } }),
  getSettings: () => call('get_settings'),
  saveAgingSetting: (days) => call('save_aging_setting', { method: 'POST', body: { aging_grace_days: days } }),
  saveTaxSetting: (percent, companyId, recalc) =>
    call('save_tax_setting', { method: 'POST', body: { tax_withheld_percent: percent, company_id: companyId, recalc_existing: recalc ? 1 : 0 } }),

  // reports
  getAging: (params) => call('get_aging', { params }),
  getPastDue: () => call('get_past_due'),

  // soa tracker
  getSoaTracker: (prefix) => call('get_soa_tracker', { params: { prefix } }),
  soaGenerate: (body) => call('soa_generate', { method: 'POST', body }),
  soaUpdateEntry: (body) => call('soa_update_entry', { method: 'POST', body }),
  soaCheck: (number) => call('soa_check', { params: { number } }),

  // monitoring
  getMonitoring: () => call('get_monitoring'),
  createMonitoring: (body) => call('create_monitoring', { method: 'POST', body }),
  updateMonitoring: (body) => call('update_monitoring', { method: 'POST', body }),
  deleteMonitoring: (id) => call('delete_monitoring', { method: 'POST', body: { id } }),
};