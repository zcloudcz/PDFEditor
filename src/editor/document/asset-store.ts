import { base64Bytes, bytesBase64 } from '../studio/project-validation';

export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
const MAX_ASSETS = 10001;
export type AssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
export interface EmbeddedAsset { hash: string; mime: AssetMime; base64: string }
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
export async function assetHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function decodeAsset(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || !base64.length || base64.length > MAX_PROJECT_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid embedded asset');
  const bytes = base64Bytes(base64);
  if (bytesBase64(bytes) !== base64) throw new Error('Noncanonical embedded asset');
  return bytes;
}
export async function validateAssets(value: unknown): Promise<assertsNever> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid assets');
  let total = 0;
  const entries = Object.entries(value);
  if (entries.length > MAX_ASSETS) throw new Error('Too many assets');
  for (const [id, asset] of entries) {
    if (!asset || Object.keys(asset).some(k => !['hash', 'mime', 'base64'].includes(k)) || !/^[a-f0-9]{64}$/.test(id) || asset.hash !== id || !mimeTypes.has(asset.mime)) throw new Error('Invalid asset descriptor');
    const bytes = decodeAsset(asset.base64);
    total += bytes.length;
    if (total > MAX_PROJECT_BYTES) throw new Error('Assets exceed size limit');
    if (await assetHash(bytes) !== id) throw new Error('Asset hash mismatch');
  }
}
type assertsNever = void;

/** Content-addressed local data; no fetch or URL resolution occurs here. */
export class AssetStore {
  private assets: Record<string, EmbeddedAsset> = Object.create(null);
  private totalBytes = 0;
  private count = 0;
  async add(bytes: Uint8Array, mime: AssetMime): Promise<string> {
    if (!mimeTypes.has(mime) || !bytes.length || bytes.length > MAX_PROJECT_BYTES) throw new Error('Invalid asset');
    const copy = new Uint8Array(bytes);
    const hash = await assetHash(copy);
    if (this.assets[hash] && this.assets[hash].mime !== mime) throw new Error('Conflicting asset MIME');
    if (!this.assets[hash]) {
      if (this.count >= MAX_ASSETS) throw new Error('Too many assets');
      if (this.totalBytes + copy.length > MAX_PROJECT_BYTES) throw new Error('Assets exceed size limit');
      this.assets[hash] = { hash, mime, base64: bytesBase64(copy) };
      this.totalBytes += copy.length;
      this.count++;
    }
    return hash;
  }
  async addDataUrl(src: string): Promise<string> {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(src);
    if (!match) throw new Error('Only embedded image assets are supported');
    return this.add(decodeAsset(match[2]), match[1] as AssetMime);
  }
  get(hash: string): Uint8Array {
    if (!this.assets[hash]) throw new Error('Missing asset');
    return decodeAsset(this.assets[hash].base64);
  }
  snapshot(): Record<string, EmbeddedAsset> { return structuredClone(this.assets); }
}

