import { t } from '../i18n';
import JSZip from 'jszip';
import type { StudioProject } from './types';
import { validateProject } from './project-validation';
export { validateProject, base64Bytes, bytesBase64 } from './project-validation';
import { migrateProject, toStudioProject } from '../document/migrations';
import { exportProjectBundle, importProjectBundle } from '../document/project-v2';
const MAX = 100 * 1024 * 1024;
const fail = (): never => { throw new Error(t('Neplatný nebo příliš velký soubor projektu.')); };

/** Portable disk/recovery boundary; runtime snapshots keep the synchronous v1 codec. */
export async function serializePortableProject(project: StudioProject): Promise<string> {
  return exportProjectBundle(await migrateProject(project));
}
export async function parsePortableProject(text: string): Promise<StudioProject> {
  if (text.length > MAX || new TextEncoder().encode(text).length > MAX) fail();
  const value: unknown = JSON.parse(text, (key, value: unknown) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail();
    return value;
  });
  const migrated = (value as {version?: unknown})?.version === 2
    ? await importProjectBundle(text) : await migrateProject(value);
  return toStudioProject(migrated);
}
export function serializeProject(project: StudioProject): string {
  validateProject(project);
  const text = JSON.stringify(project);
  if (text.length > MAX) fail();
  return text;
}
export function parseProject(text: string): StudioProject {
  if (text.length > MAX) fail();
  const p: unknown = JSON.parse(text);
  validateProject(p);
  return p;
}
export async function exportProjectZip(
  project: StudioProject
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('project.json', await serializePortableProject(project));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
export async function parseProjectZip(
  bytes: Uint8Array
): Promise<StudioProject> {
  if (bytes.length > MAX) fail();
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('project.json');
  if (!file || ('unsafeOriginalName' in file && file.unsafeOriginalName !== 'project.json')) fail();
  let size = 0;
  const stream = (
    file as unknown as {
      internalStream(type: string): {
        on(event: string, callback: (value: any) => void): void;
        pause(): void;
        resume(): void;
      };
    }
  ).internalStream('string');
  return new Promise((resolve, reject) => {
    let text = '';
    stream.on('data', (chunk: string) => {
      size += chunk.length;
      if (size > MAX) {
        stream.pause();
        reject(new Error(t('Projekt je příliš velký.')));
        return;
      }
      text += chunk;
    });
    stream.on('error', reject);
    stream.on('end', () => {
      try {
        parsePortableProject(text).then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
    stream.resume();
  });
}


