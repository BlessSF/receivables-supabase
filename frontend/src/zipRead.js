// Reads .zip files in the browser (no library): lists what is inside and pulls out one file at a time.
// Handles the two normal ZIP storage methods (stored and deflate), which covers zips made by Windows, Mac and WinRAR.

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export const MAX_ZIP_BYTES = 50 * 1024 * 1024;

export const zipSupported = () => typeof DecompressionStream === 'function';

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function bytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// List every file inside a zip: [{ name, size, csize, method, offset, encrypted }]. Folders are left out.
export async function listZip(blob) {
  if (blob.size < 22) throw new Error('This zip file looks empty or damaged.');
  const tailLen = Math.min(blob.size, 22 + 65535);
  const tail = await bytes(blob, blob.size - tailLen, blob.size);
  const tv = new DataView(tail.buffer);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) { if (u32(tv, i) === SIG_EOCD) { e = i; break; } }
  if (e < 0) throw new Error('This does not look like a valid .zip file.');
  const count = u16(tv, e + 10);
  const cenSize = u32(tv, e + 12);
  const cenOffset = u32(tv, e + 16);
  if (count === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) throw new Error('This zip uses a format that is too large to read here.');
  const cen = await bytes(blob, cenOffset, cenOffset + cenSize);
  const cv = new DataView(cen.buffer);
  const out = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cen.length; i++) {
    if (u32(cv, p) !== SIG_CEN) throw new Error('This zip file looks damaged.');
    const flags = u16(cv, p + 8);
    const method = u16(cv, p + 10);
    const csize = u32(cv, p + 20);
    const size = u32(cv, p + 24);
    const nameLen = u16(cv, p + 28);
    const extraLen = u16(cv, p + 30);
    const commentLen = u16(cv, p + 32);
    const offset = u32(cv, p + 42);
    const name = new TextDecoder('utf-8').decode(cen.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // a folder
    out.push({ name, size, csize, method, offset, encrypted: !!(flags & 1) });
  }
  return out;
}

// Pull one file out of a zip as a Blob. `maxBytes` stops a file that expands to something huge.
export async function readZipEntry(blob, entry, maxBytes) {
  if (entry.encrypted) throw new Error('This file is password-protected inside the zip.');
  const head = await bytes(blob, entry.offset, entry.offset + 30);
  const hv = new DataView(head.buffer);
  if (u32(hv, 0) !== SIG_LOC) throw new Error('This zip file looks damaged.');
  const start = entry.offset + 30 + u16(hv, 26) + u16(hv, 28);
  const raw = blob.slice(start, start + entry.csize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error('This zip uses a compression type that cannot be read.');
  if (!zipSupported()) throw new Error('This browser cannot open zip files. Please use a recent Chrome, Edge, Firefox or Safari.');
  const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (maxBytes && total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('File is too large (limit 3 MB).'); }
    parts.push(value);
  }
  return new Blob(parts);
}