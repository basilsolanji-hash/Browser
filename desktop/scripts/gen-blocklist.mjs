// Блок-лист трекеров и майнеров из EasyPrivacy (лицензия GPLv3 или CC BY-SA 3.0, на выбор).
// Берём только правила на домены целиком («||host^» и «||host^$third-party»): они быстрые и надёжные.
// Список Disconnect не используем: его лицензия CC BY-NC-SA запрещает коммерческое использование.
// Запуск вручную при обновлении списка: node scripts/gen-blocklist.mjs → assets/blocklist.json.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy/';
const FILES = ['trackingservers', 'trackingservers_general', 'trackingservers_thirdparty', 'trackingservers_international',
  'trackingservers_admiral', 'trackingservers_mining', 'thirdparty'];
const RULE = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\^(\$third-party)?$/;

const domains = new Set();
const miners = new Set();
for (const f of FILES) {
  const res = await fetch(`${BASE}easyprivacy_${f}.txt`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  for (const line of (await res.text()).split('\n')) {
    const m = RULE.exec(line.trim());
    if (!m) continue;
    domains.add(m[1]);
    if (f === 'trackingservers_mining') miners.add(m[1]);
  }
}
const out = {
  source: 'EasyPrivacy (https://easylist.to), host rules only',
  license: 'GPL-3.0-or-later OR CC-BY-SA-3.0',
  generated: new Date().toISOString().slice(0, 10),
  domains: [...domains].sort(),
  miners: [...miners].sort(),
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/blocklist.json'), JSON.stringify(out));
console.log(`blocklist: ${out.domains.length} domains (${out.miners.length} miners)`);
