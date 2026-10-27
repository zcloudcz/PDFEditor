import { describe, expect, it } from 'vitest';
import { parsePortableProject, serializePortableProject } from './project-io';
import { validateProject } from './project-validation';
import type { StudioProject } from './types';
const project = (): StudioProject => ({ version: 1, name: 'Text', pages: [{ id: 'p', name: 'Page', width: 600, height: 800, background: '#ffffff', objects: [{
  id: 't', name: 'Text', kind: 'text', text: 'First\nSecond', fontSize: 24, x: 10, y: 20, width: 300, height: 150, rotation: 0, opacity: 0.7,
  fill: '#000000', stroke: '#ff0000', strokeWidth: 0.5, locked: false,
  layoutAnchors: { horizontal: 'end', vertical: 'center' }, tracking: 0.5, paragraphSpacing: 8,
  textShadow: { x: 3, y: 4, color: '#000000', opacity: 0.4 }, textGradient: { from: '#ff0000', to: '#0000ff' },
}] }] });
describe('portable text and layout metadata', () => {
  it('roundtrips effects, spacing and persistent anchors through the production v2 boundary', async () => {
    const input = project(); expect(await parsePortableProject(await serializePortableProject(input))).toEqual(input);
    input.pages[0].objects[0].textPath = { radius: 500 };
    expect(await parsePortableProject(await serializePortableProject(input))).toEqual(input);
  });
  it.each([
    { paragraphSpacing: -1 }, { tracking: Infinity }, { textPath: { radius: 0 } }, { textPath: { radius: 500, url: 'https://example.com' } },
    { textShadow: { x: 0, y: 0, color: 'none', opacity: 1 } }, { textGradient: { from: '#ffffff', to: 'url(x)' } },
    { layoutAnchors: { horizontal: 'invalid', vertical: 'center' } },
  ])('rejects malformed text metadata %j', patch => {
    const input = project(); Object.assign(input.pages[0].objects[0], patch); expect(() => validateProject(input)).toThrow();
  });
  it('rejects text effect metadata on other object types', () => {
    const input = project(); input.pages[0].objects[0].kind = 'rect'; expect(() => validateProject(input)).toThrow();
  });
});
