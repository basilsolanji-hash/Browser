// «Предложить надёжный пароль» на формах регистрации и смены пароля.
// Пароль создаётся здесь же (crypto.getRandomValues), никуда не отправляется; сохранить его
// предложит сам браузер после отправки формы — в пароли профиля.
(() => {
  const T = {
    en: ['Suggest a strong password', 'Password filled in — Ось will offer to save it'],
    ru: ['Предложить надёжный пароль', 'Пароль вставлен — Ось предложит сохранить его'],
    es: ['Sugerir una contraseña segura', 'Contraseña insertada: Ось ofrecerá guardarla'],
    pt: ['Sugerir uma senha forte', 'Senha inserida — o Ось vai oferecer salvá-la'],
    fr: ['Suggérer un mot de passe fort', 'Mot de passe inséré — Ось proposera de l’enregistrer'],
    de: ['Starkes Passwort vorschlagen', 'Passwort eingefügt — Ось bietet an, es zu speichern'],
    ar: ['اقتراح كلمة مرور قوية', 'تم إدراج كلمة المرور — سيعرض Ось حفظها'],
    hi: ['मज़बूत पासवर्ड सुझाएँ', 'पासवर्ड भर दिया — Ось इसे सहेजने का सुझाव देगा'],
    tr: ['Güçlü bir parola öner', 'Parola eklendi — Ось kaydetmeyi önerecek'],
    zh: ['建议使用强密码', '已填入密码，Ось 会提示保存'],
  };
  const t = T[(navigator.language || 'en').slice(0, 2)] || T.en;

  // Без похожих символов (0/O, 1/l/I); обязательно буквы обоих регистров, цифра и знак.
  function generate(len = 16) {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_.!@#%+=?'];
    const all = sets.join('');
    const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
    const out = sets.map(s => s[rnd(s.length)]);
    while (out.length < len) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }

  const SIGNUP = /sign[-_ ]?up|regist|join|create|new[-_ ]?account|enroll|zaregistr|регистр|создать/i;
  function isNewPassword(input) {
    if (!input || input.type !== 'password' || input.readOnly || input.disabled) return false;
    const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
    if (ac.includes('new-password')) return true;
    if (ac.includes('current-password')) return false;
    const form = input.form;
    const fields = form ? form.querySelectorAll('input[type=password]') : [];
    if (fields.length >= 2) return true;
    const hints = [location.pathname, form && form.action, form && form.id, form && form.className, input.name, input.id].join(' ');
    return SIGNUP.test(hints);
  }

  let chip = null, target = null, hideTimer = 0;
  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement('div');
    chip.setAttribute('role', 'button');
    chip.style.cssText = 'position:absolute;z-index:2147483647;background:#17181B;color:#fff;border:1px solid #F0453A;' +
      'border-radius:10px;padding:10px 14px;font:600 14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);' +
      'cursor:pointer;max-width:90vw;display:none';
    // mousedown, а не click: поле не теряет фокус до вставки.
    chip.addEventListener('mousedown', e => { e.preventDefault(); fill(); }, true);
    chip.addEventListener('touchstart', e => { e.preventDefault(); fill(); }, { capture: true, passive: false });
    document.documentElement.appendChild(chip);
    return chip;
  }
  function place() {
    if (!chip || !target) return;
    const r = target.getBoundingClientRect();
    chip.style.left = (window.scrollX + r.left) + 'px';
    chip.style.top = (window.scrollY + r.bottom + 6) + 'px';
  }
  function show(input) {
    target = input;
    const c = ensureChip();
    c.textContent = '🔑 ' + t[0];
    c.style.display = 'block';
    place();
  }
  function hide() { if (chip) chip.style.display = 'none'; target = null; }
  function setValue(el, v) {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    proto.set.call(el, v); // React и др. видят изменение
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fill() {
    if (!target) return;
    const pass = generate();
    const scope = target.form || document;
    const fields = [...scope.querySelectorAll('input[type=password]')].filter(f => f === target || isNewPassword(f) || !f.value);
    fields.forEach(f => setValue(f, pass));
    chip.textContent = '✓ ' + t[1];
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 3000);
  }

  document.addEventListener('focusin', e => { if (isNewPassword(e.target)) show(e.target); }, true);
  document.addEventListener('focusout', e => { if (e.target === target) setTimeout(() => { if (document.activeElement !== target) hide(); }, 200); }, true);
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
})();
