'use strict';
const fallbackErrors = {"en": "Service is unavailable", "ru": "Сервис недоступен", "es": "El servicio no está disponible", "pt": "Serviço indisponível", "fr": "Service indisponible", "de": "Dienst nicht verfügbar", "ar": "الخدمة غير متاحة", "hi": "सेवा उपलब्ध नहीं है", "tr": "Hizmet kullanılamıyor", "zh": "服务不可用", "be": "Сэрвіс недаступны", "uz": "Xizmat mavjud emas", "ky": "Кызмат жеткиликсиз", "tg": "Хидмат дастнорас аст", "kk": "Қызмет қолжетімсіз", "hy": "Ծառայությունն անհասանելի է"};
(async () => {
  const $ = (id) => document.getElementById(id);
  let dictionary;
  try { dictionary = await (await fetch('/admin/i18n.json', { cache: 'no-store' })).json(); }
  catch { const code = new URL(location.href).searchParams.get('lang') ?? navigator.language.split('-')[0]; $('notice').textContent = fallbackErrors[code] ?? fallbackErrors.en; return; }
  const candidate = new URL(location.href).searchParams.get('lang') ?? navigator.language.split('-')[0];
  const lang = Object.hasOwn(dictionary, candidate) ? candidate : 'en';
  const words = dictionary[lang], t = (key) => words[key];
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = `${t('title')} · Ось Browser`;
  document.querySelectorAll('[data-t]').forEach((node) => { node.textContent = t(node.dataset.t); });
  for (const code of Object.keys(dictionary)) {
    const option = document.createElement('option'); option.value = code;
    option.textContent = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    $('language').append(option);
  }
  $('language').value = lang;
  $('language').onchange = () => { const url = new URL(location.href); url.searchParams.set('lang', $('language').value); location.assign(url); };
  const today = new Date(Date.now() - 86400000); $('until').value = today.toISOString().slice(0, 10);
  $('since').value = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const number = new Intl.NumberFormat(lang);
  const bytes = new Intl.NumberFormat(lang, { style: 'unit', unit: 'byte', unitDisplay: 'short', maximumFractionDigits: 0 });
  let authEpoch = 0, loadSerial = 0, pendingSummary = null, expiryTimer = null;
  let locallySignedOut = false;
  try { locallySignedOut = sessionStorage.getItem('os.admin.signedOut') === '1'; } catch {}
  const setLocalSignout = (value) => {
    locallySignedOut = value;
    try { if (value) sessionStorage.setItem('os.admin.signedOut', '1'); else sessionStorage.removeItem('os.admin.signedOut'); } catch {}
  };
  const invalidate = () => {
    authEpoch++; loadSerial++;
    pendingSummary?.abort(); pendingSummary = null;
    clearTimeout(expiryTimer); expiryTimer = null;
    $('refresh').disabled = false;
    return authEpoch;
  };
  const showLogin = () => { $('dashboard').hidden = true; $('login').hidden = false; };
  const clearMetrics = () => { for (const key of ['users', 'devices', 'storageBytes', 'syncErrors', 'syncSuccesses', 'health']) $(key).textContent = '—'; $('rows').replaceChildren(); $('usage-table').hidden = true; $('empty').hidden = false; };
  const featureLabel = (key) => ({ profile_switch: 'profiles', quick_search: 'search', notes_open: 'notes',
    notes_create: 'notes', favorites_add: 'favorites', password_save: 'passwords', download_start: 'dl_title', sync_manual: 'sync' })[key];
  const closeView = () => { invalidate(); clearMetrics(); showLogin(); };
  const armExpiry = (response, started) => {
    const ttl = Number(response.headers.get('X-Admin-Session-TTL'));
    // Subtract the entire round trip: never extend a session because a response was delayed.
    const remaining = ttl - (performance.now() - started);
    clearTimeout(expiryTimer);
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 15 * 60000 || remaining <= 0) { closeView(); return false; }
    expiryTimer = setTimeout(closeView, remaining);
    return true;
  };
  async function load() {
    if (locallySignedOut) { showLogin(); return; }
    pendingSummary?.abort();
    const controller = new AbortController(); pendingSummary = controller;
    const epoch = authEpoch, serial = ++loadSerial, started = performance.now();
    const current = () => epoch === authEpoch && serial === loadSerial && !controller.signal.aborted;
    $('notice').textContent = ''; clearMetrics(); $('refresh').disabled = true;
    try {
      const query = new URLSearchParams({ since: $('since').value, until: $('until').value });
      const response = await fetch(`/admin/api/summary?${query}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!current()) return;
      if (response.status === 401) { closeView(); return; }
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (!current() || !armExpiry(response, started)) return;
      $('login').hidden = true; $('dashboard').hidden = false;
      $('connection').hidden = data.service !== null;
      if (data.service) for (const key of ['users', 'devices', 'storageBytes', 'syncErrors', 'syncSuccesses', 'health']) {
        const value = data.service[key];
        $(key).textContent = value === null ? '—' : key === 'health' ? t(`health_${value}`) : (key === 'storageBytes' ? bytes : number).format(value);
      }
      const grouped = new Map();
      for (const item of data.usage) {
        const label = featureLabel(item.feature); if (!label) continue;
        const row = grouped.get(label) ?? { android: null, windows: null };
        row[item.platform] = (row[item.platform] ?? 0) + item.count; grouped.set(label, row);
      }
      for (const [key, counts] of grouped) {
        const row = document.createElement('tr');
        for (const value of [t(key), counts.android === null ? '—' : number.format(counts.android), counts.windows === null ? '—' : number.format(counts.windows), number.format(counts.android + counts.windows)]) {
          const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
        }
        $('rows').append(row);
      }
      $('empty').hidden = grouped.size > 0; $('usage-table').hidden = grouped.size === 0;
    } catch { if (current()) { $('notice').textContent = t('unavailable'); if ($('dashboard').hidden) $('login').hidden = false; } }
    finally { if (current()) { pendingSummary = null; $('refresh').disabled = false; } }
  }
  $('login-form').onsubmit = async (event) => {
    event.preventDefault(); const epoch = invalidate(); const button = event.submitter; button.disabled = true; $('notice').textContent = '';
    try {
      const response = await fetch('/admin/session', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: $('token').value }) });
      if (epoch !== authEpoch) return;
      if (!response.ok) { $('notice').textContent = t(response.status === 401 ? 'invalid' : 'unavailable'); return; }
      setLocalSignout(false); await load();
    } catch { if (epoch === authEpoch) { $('notice').textContent = t('unavailable'); if ($('dashboard').hidden) $('login').hidden = false; } }
    finally { $('token').value = ''; button.disabled = false; }
  };
  $('logout').onclick = async () => {
    const epoch = invalidate(); setLocalSignout(true); clearMetrics(); showLogin(); $('notice').textContent = '';
    try {
      const r = await fetch('/admin/session', { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error('unavailable');
    } catch { if (epoch === authEpoch) $('notice').textContent = t('unavailable'); }
  };
  $('refresh').onclick = load;
  $('period').onsubmit = (event) => { event.preventDefault(); if ($('since').value <= $('until').value) load(); };
  const revalidate = () => { if (!locallySignedOut && !document.hidden) { clearMetrics(); load(); } };
  document.addEventListener('visibilitychange', revalidate);
  window.addEventListener('pageshow', (event) => { if (event.persisted) revalidate(); });
  await load();
})();
