// Proof of payment: a photo or a PDF. Photos are shrunk in the browser first (so a phone picture of 8 MB becomes a few hundred KB).
export const PROOF_MAX = 3 * 1024 * 1024; // must match the server
export const PROOF_FILES = 5;
export const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const readDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(blob); });
export async function prepareProof(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImg = /^image\//.test(file.type);
  if (!isPdf && !isImg) throw new Error(`"${file.name}" is not allowed. Only photos and PDF files can be attached.`);
  let blob = file;
  let name = file.name;
  if (isImg && file.type !== 'image/gif' && (file.size > 700 * 1024)) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      const out = await new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.82));
      if (out && out.size < file.size) { blob = out; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
    } catch { /* keep the original */ }
  }
  if (blob.size > PROOF_MAX) throw new Error(`"${file.name}" is too big (${kb(blob.size)}). The limit is ${kb(PROOF_MAX)} per file.`);
  return { name, size: blob.size, data: await readDataUrl(blob) };
}