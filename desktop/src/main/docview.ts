import { inflateRawSync } from 'node:zlib';

/**
 * Просмотр документов прямо в Оси, без интернета и чужих сервисов (DocView.kt): Word (DOCX), Excel (XLSX),
 * PowerPoint (PPTX), OpenDocument (ODT, ODS, ODP) и CSV превращаются в простую HTML-страницу (текст,
 * заголовки, жирный/курсив, таблицы, листы, слайды, картинки DOCX). Без electron — проверяется юнит-тестами.
 */
const EXT = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'csv']);
const MAX_ENTRY = 40 * 1024 * 1024;
const MAX_ROWS = 3000;
const MAX_COLS = 60;

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
export const supports = (name: string) => EXT.has(extOf(name));

/** HTML-страница документа; null — формат не поддержан или файл повреждён. */
export function toHtml(data: Buffer, name: string): string | null {
  try {
    const ext = extOf(name);
    let body: string;
    if (ext === 'csv') body = csv(data.toString('utf8').replace(/^\uFEFF/, ''));
    else {
      const zip = unzip(data);
      if (ext === 'docx') body = docx(zip);
      else if (ext === 'xlsx') body = xlsx(zip);
      else if (ext === 'pptx') body = pptx(zip);
      else if (ext === 'odt' || ext === 'ods' || ext === 'odp') body = odf(zip);
      else return null;
    }
    return page(name, body);
  } catch {
    return null;
  }
}

// --- Общее ---

/** Распаковка zip по центральному каталогу: «stored» и «deflate», без внешних библиотек. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || size > MAX_ENTRY) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }));
  }
  return out;
}

interface Ev { t: 'start' | 'end' | 'text'; name: string; attrs: Record<string, string>; text: string }

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }
  return ENT[e] ?? m;
});

/** Простейший потоковый разбор XML (как XmlPullParser без пространств имён): теги, атрибуты, текст. */
function events(bytes: Buffer): Ev[] {
  const xml = bytes.toString('utf8');
  const out: Ev[] = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] != null) out.push({ t: 'text', name: '', attrs: {}, text: m[1] });
    else if (m[2]) out.push({ t: 'end', name: m[2], attrs: {}, text: '' });
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      out.push({ t: 'start', name: m[3], attrs, text: '' });
      if (m[5]) out.push({ t: 'end', name: m[3], attrs: {}, text: '' });
    } else if (m[6] != null) out.push({ t: 'text', name: '', attrs: {}, text: decode(m[6]) });
  }
  return out;
}

/** Текст до конца текущего тега (nextText), сдвигает позицию за закрывающий тег. */
function nextText(ev: Ev[], i: { v: number }): string {
  const name = ev[i.v].name;
  let s = '';
  let depth = 0;
  while (++i.v < ev.length) {
    const e = ev[i.v];
    if (e.t === 'text') s += e.text;
    else if (e.t === 'start') depth++;
    else if (e.t === 'end') {
      if (depth === 0 && e.name === name) break;
      depth--;
    }
  }
  return s;
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--bg:#fff;--fg:#1b1b1d;--muted:#666;--line:#ddd;--head:#f3f3f5}
@media (prefers-color-scheme: dark){:root{--bg:#17181B;--fg:#ececee;--muted:#9a9aa2;--line:#33343a;--head:#222328}}
body{background:var(--bg);color:var(--fg);font:16px/1.55 "Segoe UI",system-ui,sans-serif;margin:0 auto;padding:16px 24px;max-width:960px;overflow-wrap:anywhere}
h1.doc{font-size:15px;color:var(--muted);font-weight:600;margin:0 0 14px}
table{border-collapse:collapse;margin:10px 0;font-size:14px}td,th{border:1px solid var(--line);padding:4px 8px;vertical-align:top}
th{background:var(--head);color:var(--muted);font-weight:600}.wrap{overflow-x:auto}
.slide{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}.slide h3{margin:0 0 8px;color:var(--muted);font-size:13px}
img{max-width:100%;height:auto}li{margin:2px 0}</style></head><body><h1 class="doc">${esc(title)}</h1>
${body}</body></html>`;

const target = (sb: string[], cells: string[][]) => cells[cells.length - 1] ?? sb;

function relations(bytes: Buffer | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!bytes) return out;
  for (const e of events(bytes)) if (e.t === 'start' && e.name === 'Relationship') out.set(e.attrs.Id ?? '', e.attrs.Target ?? '');
  return out;
}

// --- Word (DOCX) ---

function docx(zip: Map<string, Buffer>): string {
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('no document.xml');
  const rels = relations(zip.get('word/_rels/document.xml.rels'));
  const sb: string[] = [];
  const ev = events(doc);
  let para: string[] = [];
  let tag = 'p';
  let list = false;
  let bold = false, italic = false, underline = false;
  const cells: string[][] = [];
  const i = { v: -1 };
  while (++i.v < ev.length) {
    const e = ev[i.v];
    if (e.t === 'start') {
      switch (e.name) {
        case 'w:p': para = []; tag = 'p'; list = false; break;
        case 'w:pStyle': {
          const v = (e.attrs['w:val'] ?? '').toLowerCase();
          if (['title', 'heading1', 'заголовок1'].includes(v)) tag = 'h1';
          else if (['heading2', 'subtitle', 'заголовок2'].includes(v)) tag = 'h2';
          else if (['heading3', 'heading4', 'заголовок3'].includes(v)) tag = 'h3';
          break;
        }
        case 'w:numPr': list = true; break;
        case 'w:r': bold = false; italic = false; underline = false; break;
        case 'w:b': bold = e.attrs['w:val'] !== '0'; break;
        case 'w:i': italic = e.attrs['w:val'] !== '0'; break;
        case 'w:u': underline = e.attrs['w:val'] !== 'none'; break;
        case 'w:t': {
          let t = esc(nextText(ev, i));
          if (underline) t = `<u>${t}</u>`;
          if (italic) t = `<i>${t}</i>`;
          if (bold) t = `<b>${t}</b>`;
          para.push(t);
          break;
        }
        case 'w:tab': para.push('&emsp;'); break;
        case 'w:br': para.push('<br>'); break;
        case 'a:blip': {
          const t = rels.get(e.attrs['r:embed'] ?? '');
          const path = t ? (t.startsWith('/') ? t.slice(1) : `word/${t}`) : '';
          const bytes = path ? zip.get(path) : undefined;
          if (bytes) {
            const mime = /\.png$/i.test(path) ? 'image/png' : /\.gif$/i.test(path) ? 'image/gif' : 'image/jpeg';
            para.push(`<img src="data:${mime};base64,${bytes.toString('base64')}">`);
          }
          break;
        }
        case 'w:tbl': sb.push(cells.length ? '<table>' : '<div class="wrap"><table>'); break;
        case 'w:tr': target(sb, cells).push('<tr>'); break;
        case 'w:tc': cells.push([]); break;
      }
    } else if (e.t === 'end') {
      switch (e.name) {
        case 'w:p': {
          const html = para.join('');
          target(sb, cells).push(list ? `<li>${html}</li>` : html ? `<${tag}>${html}</${tag}>` : '');
          break;
        }
        case 'w:tc': { const c = cells.pop()!; target(sb, cells).push(`<td>${c.join('')}</td>`); break; }
        case 'w:tr': target(sb, cells).push('</tr>'); break;
        case 'w:tbl': target(sb, cells).push(cells.length ? '</table>' : '</table></div>'); break;
      }
    }
  }
  return sb.join('').replace(/(<\/li>)(?!<li>)/g, '$1</ul>').replace(/(?<!<\/li>)(<li>)/g, '<ul>$1');
}

// --- Excel (XLSX) ---

function xlsx(zip: Map<string, Buffer>): string {
  const shared: string[] = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    const ev = events(ss);
    let cur: string | null = null;
    const i = { v: -1 };
    while (++i.v < ev.length) {
      const e = ev[i.v];
      if (e.t === 'start' && e.name === 'si') cur = '';
      else if (e.t === 'start' && e.name === 't' && cur != null) cur += nextText(ev, i);
      else if (e.t === 'end' && e.name === 'si') { shared.push(cur ?? ''); cur = null; }
    }
  }
  const rels = relations(zip.get('xl/_rels/workbook.xml.rels'));
  const sheets: [string, string][] = [];
  const wb = zip.get('xl/workbook.xml');
  if (wb) {
    for (const e of events(wb)) {
      if (e.t !== 'start' || e.name !== 'sheet') continue;
      const t = rels.get(e.attrs['r:id'] ?? '');
      if (t) sheets.push([e.attrs.name ?? '', t.startsWith('/') ? t.slice(1) : `xl/${t}`]);
    }
  }
  if (!sheets.length) [...zip.keys()].filter((k) => k.startsWith('xl/worksheets/sheet')).sort().forEach((k, n) => sheets.push([String(n + 1), k]));
  let sb = '';
  for (const [name, path] of sheets) {
    const bytes = zip.get(path);
    if (!bytes) continue;
    if (sheets.length > 1) sb += `<h2>${esc(name)}</h2>`;
    sb += sheetTable(bytes, shared);
  }
  return sb;
}

function column(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function columnName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetTable(bytes: Buffer, shared: string[]): string {
  const rows: [number, Map<number, string>][] = [];
  const ev = events(bytes);
  let row = new Map<number, string>();
  let rowNum = 0, col = 0, type = '', value = '', inCell = false;
  const i = { v: -1 };
  while (++i.v < ev.length && rows.length < MAX_ROWS) {
    const e = ev[i.v];
    if (e.t === 'start') {
      if (e.name === 'row') { row = new Map(); rowNum = Number(e.attrs.r) || rowNum + 1; }
      else if (e.name === 'c') {
        col = e.attrs.r ? column(e.attrs.r) : (row.size ? Math.max(...row.keys()) + 1 : 0);
        type = e.attrs.t ?? ''; value = ''; inCell = true;
      } else if ((e.name === 'v' || e.name === 't') && inCell) value += nextText(ev, i);
    } else if (e.t === 'end') {
      if (e.name === 'c') {
        inCell = false;
        const text = type === 's' ? (shared[Number(value)] ?? '') : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value;
        if (text && col >= 0 && col < MAX_COLS) row.set(col, text);
      } else if (e.name === 'row' && row.size) rows.push([rowNum, row]);
    }
  }
  if (!rows.length) return '<p>—</p>';
  const cols = Math.min(MAX_COLS, Math.max(...rows.map(([, r]) => Math.max(...r.keys()))) + 1);
  let sb = '<div class="wrap"><table><tr><th></th>';
  for (let c = 0; c < cols; c++) sb += `<th>${columnName(c)}</th>`;
  sb += '</tr>';
  for (const [n, cells] of rows) {
    sb += `<tr><th>${n}</th>`;
    for (let c = 0; c < cols; c++) sb += `<td>${esc(cells.get(c) ?? '')}</td>`;
    sb += '</tr>';
  }
  return sb + '</table></div>';
}

// --- PowerPoint (PPTX) ---

function pptx(zip: Map<string, Buffer>): string {
  const slides = [...zip.keys()]
    .map((k) => { const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(k); return m ? ([Number(m[1]), k] as const) : null; })
    .filter((x): x is readonly [number, string] => x != null)
    .sort((a, b) => a[0] - b[0]);
  let sb = '';
  for (const [n, key] of slides) {
    const ev = events(zip.get(key)!);
    const paras: string[] = [];
    let cur = '';
    const i = { v: -1 };
    while (++i.v < ev.length) {
      const e = ev[i.v];
      if (e.t === 'start' && e.name === 'a:p') cur = '';
      else if (e.t === 'start' && e.name === 'a:t') cur += esc(nextText(ev, i));
      else if (e.t === 'end' && e.name === 'a:p' && cur.trim()) paras.push(cur);
    }
    sb += `<div class="slide"><h3>${n}</h3>${paras.map((t, k) => (k === 0 ? `<h2>${t}</h2>` : `<p>${t}</p>`)).join('')}</div>`;
  }
  return sb;
}

// --- OpenDocument (ODT, ODS, ODP) ---

function odf(zip: Map<string, Buffer>): string {
  const content = zip.get('content.xml');
  if (!content) throw new Error('no content.xml');
  const sb: string[] = [];
  let cur: string | null = null;
  let tag = 'p';
  const cells: string[][] = [];
  for (const e of events(content)) {
    if (e.t === 'start') {
      switch (e.name) {
        case 'text:h': cur = ''; tag = 'h2'; break;
        case 'text:p': cur = ''; tag = 'p'; break;
        case 'text:tab': if (cur != null) cur += '&emsp;'; break;
        case 'text:line-break': if (cur != null) cur += '<br>'; break;
        case 'draw:page': target(sb, cells).push('<div class="slide">'); break;
        case 'table:table': target(sb, cells).push('<div class="wrap"><table>'); break;
        case 'table:table-row': target(sb, cells).push('<tr>'); break;
        case 'table:table-cell': cells.push([]); break;
      }
    } else if (e.t === 'text') {
      if (cur != null) cur += esc(e.text);
    } else {
      switch (e.name) {
        case 'text:h': case 'text:p':
          if (cur?.trim()) target(sb, cells).push(`<${tag}>${cur}</${tag}>`);
          cur = null;
          break;
        case 'table:table-cell': { const c = cells.pop()!; target(sb, cells).push(`<td>${c.join('')}</td>`); break; }
        case 'table:table-row': target(sb, cells).push('</tr>'); break;
        case 'table:table': target(sb, cells).push('</table></div>'); break;
        case 'draw:page': target(sb, cells).push('</div>'); break;
      }
    }
  }
  return sb.join('');
}

// --- CSV ---

function csv(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', ',', '\t'].reduce((best, c) => (first.split(c).length > first.split(best).length ? c : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < MAX_ROWS; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === sep) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return '<p>—</p>';
  let sb = '<div class="wrap"><table>';
  rows.forEach((cells, r) => {
    const t = r === 0 ? 'th' : 'td';
    sb += `<tr>${cells.slice(0, MAX_COLS).map((c) => `<${t}>${esc(c)}</${t}>`).join('')}</tr>`;
  });
  return sb + '</table></div>';
}
