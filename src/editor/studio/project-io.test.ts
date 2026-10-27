// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePortableProject, serializePortableProject, exportProjectZip, parseProjectZip, serializeProject } from './project-io';
import type { StudioProject } from './types';

const fixture = (): StudioProject => ({ version: 1, name: 'Český projekt', sourcePdf: btoa('%PDF-1.7\n'), pages: [{ id: 'stable-page', name: 'Strana', width: 600, height: 800, background: '#ffffff', sourcePageIndex: 0, objects: [0, 1].map(i => ({ id: `image-${i}`, name: 'Obrázek', kind: 'image', src: `data:image/png;base64,${btoa('embedded-image')}`, x: 0, y: 0, width: 20, height: 20, rotation: 0, opacity: 1, fill: 'none', stroke: 'none', strokeWidth: 0, locked: false })) }] });
describe('production portable project boundary', () => {
  it('saves v2 with deduplicated media and reopens a detached runtime project', async () => {
    const project = fixture(), before = structuredClone(project);
    const pending = serializePortableProject(project); project.name = 'later mutation';
    const text = await pending, bundle = JSON.parse(text);
    expect(bundle.version).toBe(2); expect(Object.keys(bundle.assets)).toHaveLength(2);
    expect(bundle.sections[0].pages[0].id).toBe('stable-page');
    expect(await parsePortableProject(text)).toEqual(before);
  });
  it('imports old v1 downloads and produces v2 ZIPs through the actual public API', async () => {
    const project = fixture();
    expect(await parsePortableProject(serializeProject(project))).toEqual(project);
    const zipBytes = await exportProjectZip(project);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBytes);
    expect(JSON.parse(await zip.file('project.json')!.async('string')).version).toBe(2);
    expect(await parseProjectZip(zipBytes)).toEqual(project);
  });
  it('rejects unsupported sections and dangerous unrecognized keys before opening', async () => {
    const bundle = JSON.parse(await serializePortableProject(fixture()));
    bundle.sections[0].kind = 'future';
    await expect(parsePortableProject(JSON.stringify(bundle))).rejects.toThrow();
    const malicious = serializeProject(fixture()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}');
    await expect(parsePortableProject(malicious)).rejects.toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
it('rejects ZIP traversal names instead of accepting a sanitized project entry', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('../project.json', serializeProject(fixture()));
  await expect(parseProjectZip(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow();
});
