import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/**
 * Пакет расширения Chrome (CRX3): проверка подписи и распаковка zip. Свой разбор вместо сторонних
 * библиотек — меньше зависимостей, и сеть остаётся только в extensions.ts (по нажатию «Установить»).
 * Формат: "Cr24", версия 3, длина заголовка, заголовок (protobuf CrxFileHeader), zip-архив.
 */
export class CrxError extends Error {}

interface Proof { key: Buffer; sig: Buffer; kind: 'rsa' | 'ecdsa' }

/** ID расширения — первые 16 байт SHA-256 открытого ключа, цифры 0–f записаны буквами a–p. */
export function idFromKey(spki: Buffer): string {
  return [...createHash('sha256').update(spki).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
}

/** Поля protobuf верхнего уровня: номер поля → значения (только varint и байтовые строки). */
function fields(buf: Buffer): Map<number, Buffer[]> {
  const out = new Map<number, Buffer[]>();
  let i = 0;
  const varint = () => {
    let v = 0;
    for (let shift = 0; ; shift += 7) {
      if (i >= buf.length || shift > 35) throw new CrxError('bad header');
      const b = buf[i++];
      v += (b & 127) * 2 ** shift;
      if (b < 128) return v;
    }
  };
  while (i < buf.length) {
    const tag = varint();
    const wire = tag % 8;
    const no = Math.floor(tag / 8);
    if (wire === 0) { varint(); continue; }
    if (wire === 1) { i += 8; continue; }
    if (wire === 5) { i += 4; continue; }
    if (wire !== 2) throw new CrxError('bad header');
    const len = varint();
    if (i + len > buf.length) throw new CrxError('bad header');
    const list = out.get(no) ?? [];
    list.push(buf.subarray(i, i + len));
    out.set(no, list);
    i += len;
  }
  return out;
}

/**
 * Проверить CRX3 и вернуть zip, ID и открытый ключ. Все подписи в заголовке должны сходиться,
 * а одна из них — ключом, из которого получается ID (так же проверяет Chrome).
 */
export function verifyCrx(crx: Buffer, expectedId: string | null): { id: string; key: Buffer; zip: Buffer } {
  if (crx.length < 12 || crx.toString('latin1', 0, 4) !== 'Cr24') throw new CrxError('not crx');
  if (crx.readUInt32LE(4) !== 3) throw new CrxError('unsupported crx version');
  const headerLen = crx.readUInt32LE(8);
  if (12 + headerLen > crx.length) throw new CrxError('bad header');
  const header = fields(crx.subarray(12, 12 + headerLen));
  const zip = crx.subarray(12 + headerLen);
  const signed = header.get(10000)?.[0];
  if (!signed) throw new CrxError('no signed data');
  const crxId = fields(signed).get(1)?.[0];
  if (!crxId || crxId.length !== 16) throw new CrxError('no crx id');
  const id = [...crxId].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
  if (expectedId && id !== expectedId) throw new CrxError('id mismatch');
  const proofs: Proof[] = [];
  for (const [no, kind] of [[2, 'rsa'], [3, 'ecdsa']] as const) {
    for (const p of header.get(no) ?? []) {
      const f = fields(p);
      const key = f.get(1)?.[0];
      const sig = f.get(2)?.[0];
      if (!key || !sig) throw new CrxError('bad proof');
      proofs.push({ key, sig, kind });
    }
  }
  const len = Buffer.alloc(4);
  len.writeUInt32LE(signed.length);
  const prefix = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, signed]);
  let developerKey: Buffer | null = null;
  for (const p of proofs) {
    let ok: boolean;
    try {
      const v = createVerify('sha256');
      v.update(prefix);
      v.update(zip);
      ok = v.verify(createPublicKey({ key: p.key, format: 'der', type: 'spki' }), p.sig);
    } catch {
      ok = false;
    }
    if (!ok) throw new CrxError('bad signature');
    if (p.kind === 'rsa' && idFromKey(p.key) === id) developerKey = p.key;
  }
  if (!developerKey) throw new CrxError('no developer signature');
  return { id, key: developerKey, zip };
}

const MAX_FILES = 20000;
const MAX_TOTAL = 300 * 1024 * 1024;

/** Файлы zip-архива: путь → содержимое. Пути проверяются: без «..», абсолютных путей и дисков. */
export function unzip(zip: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new CrxError('bad zip');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (count > MAX_FILES || p >= zip.length) throw new CrxError('bad zip');
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new CrxError('bad zip');
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (!safePath(name)) throw new CrxError('bad path');
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new CrxError('bad zip');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (start + csize > zip.length) throw new CrxError('bad zip');
    total += size;
    if (total > MAX_TOTAL) throw new CrxError('too big');
    const raw = zip.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw new CrxError('bad zip method');
    if (data.length !== size) throw new CrxError('bad zip');
    out.set(name, data);
  }
  return out;
}

export function safePath(name: string): boolean {
  return !!name && !name.startsWith('/') && !/^[a-z]:/i.test(name) && !name.includes('\0') &&
    name.split('/').every((part) => part !== '..' && part !== '.' && part !== '');
}
