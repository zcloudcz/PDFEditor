import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sourceMessages } from '../editor/i18n/catalog';

const files = [
  'src/editor/pdf/standard-tools.ts', 'src/editor/pdf/form-panel.ts',
  'src/editor/pdf/annotation-panel.ts', 'src/editor/pdf/placement.ts',
  'src/editor/pdf/ocr-panel.ts',
  'src/editor/pdf/utility-panel.ts', 'src/editor/pdf/comparison-panel.ts',
  'src/editor/pdf/measurement-panel.ts', 'src/editor/pdf/compare-tools.ts',
  'src/editor/pdf/text-selection.ts',
  'src/editor/pdf/navigation-panel.ts',
  'src/editor/pdf/document-properties-panel.ts', 'src/editor/pdf/attachments-panel.ts',
  'src/editor/pdf/structure-tools.ts',
  'src/editor/pdf/accessibility-panel.ts', 'src/editor/pdf/advanced-objects-panel.ts',
  'src/editor/pdf/print-panel.ts',
  'src/editor/data/data-tools.ts', 'src/editor/conversion/conversion-panel.ts',
  'src/editor/pdf/redaction-panel.ts', 'src/editor/pdf/redaction-tools.ts',
  'src/editor/main.ts', 'src/editor/document-controls.ts', 'src/editor/page-settings.ts',
  'src/editor/studio/host.ts', 'src/editor/studio/canvas.ts', 'src/editor/studio/brand-kit.ts',
  'src/editor/studio/brand-library.ts', 'src/editor/studio/personal-templates.ts',
  'src/editor/studio/image-effects.ts', 'src/editor/studio/image-masks.ts',
  'src/editor/studio/mask-editor.ts', 'src/editor/studio/layout-panel.ts', 'src/editor/studio/layout-tools.ts',
  'src/editor/studio/layout-rules.ts', 'src/editor/studio/text-editor.ts',
  'src/editor/typography/fonts.ts', 'src/editor/typography/preflight.ts',
  'src/editor/studio/templates.ts', 'src/editor/studio/exports.ts',
  'src/editor/studio/document-bridge.ts', 'src/editor/studio/project-io.ts',
  'src/editor/studio/page-actions.ts', 'src/editor/studio/page-manager.ts',
  'src/editor/context-toolbar.ts', 'src/editor/studio/inline-text-editor.ts', 'src/editor/studio/text-layout.ts',
  'src/js/editcore/app.js', 'src/js/editcore/continuous-pages.js',
];

/** Read authored UI arguments, including captions selected from static lists. */
function translationLiterals(source: ts.SourceFile, includeEditorHelpers = true, extraHelpers: readonly string[] = [], secondArgumentHelpers: readonly string[] = []): string[] {
  const messages: string[] = [];
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const collectObjects = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      objects.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectObjects);
  };
  collectObjects(source);
  const add = (argument: ts.Expression | undefined) => {
    if (!argument) return;
    if (ts.isStringLiteralLike(argument)) messages.push(argument.text);
    else if (ts.isConditionalExpression(argument)) {
      add(argument.whenTrue); add(argument.whenFalse);
    } else if (ts.isElementAccessExpression(argument) && ts.isIdentifier(argument.expression)) {
      const object = objects.get(argument.expression.text);
      for (const property of object?.properties ?? []) {
        if (ts.isPropertyAssignment(property)) add(property.initializer);
      }
    } else if (ts.isElementAccessExpression(argument) && ts.isArrayLiteralExpression(argument.expression)) {
      for (const element of argument.expression.elements) add(element);
    } else if (ts.isIdentifier(argument)) {
      for (let parent: ts.Node | undefined = argument.parent; parent; parent = parent.parent) {
        if (!ts.isForOfStatement(parent) || !ts.isVariableDeclarationList(parent.initializer)) continue;
        for (const declaration of parent.initializer.declarations) {
          const rows = ts.isAsExpression(parent.expression) ? parent.expression.expression : parent.expression;
          if (!ts.isArrayBindingPattern(declaration.name) || !ts.isArrayLiteralExpression(rows)) continue;
          const index = declaration.name.elements.findIndex(element => ts.isBindingElement(element)
            && ts.isIdentifier(element.name) && element.name.text === argument.text);
          if (index < 0) continue;
          for (const row of rows.elements) {
            if (ts.isArrayLiteralExpression(row)) add(row.elements[index]);
          }
        }
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'uiText'
          || (includeEditorHelpers && ['t', 'panelButton', ...extraHelpers].includes(node.expression.text))) add(node.arguments[0]);
        if (includeEditorHelpers && (node.expression.text === 'panelInput' || secondArgumentHelpers.includes(node.expression.text))) add(node.arguments[1]);
        if (includeEditorHelpers && node.expression.text === 'select' && extraHelpers.includes('select')) {
          const options = node.arguments[1];
          if (options && ts.isArrayLiteralExpression(options)) {
            for (const row of options.elements) {
              if (ts.isArrayLiteralExpression(row) && ts.isStringLiteralLike(row.elements[1])
                && !/^[A-Z0-9/+-]+$/.test(row.elements[1].text)) add(row.elements[1]);
            }
          }
        }
      } else if (includeEditorHelpers && ts.isPropertyAccessExpression(node.expression)
        && ['registerDocumentAction', 'mountDocumentPanel', 'runPdfOperation', 'runProjectOperation'].includes(node.expression.name.text)) {
        add(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return messages;
}

describe('editor localization source coverage', () => {
  it('contains the browser-decoded keys used by static UI markers', () => {
    const known = new Set<string>(sourceMessages);
    const missing: string[] = [];
    const decoder = document.createElement('textarea');
    for (const file of [...files, 'src/editor/editor-markup.html']) {
      const source = readFileSync(resolve(file), 'utf8');
      for (const match of source.matchAll(/data-ui-(?:text|title|aria-label|placeholder|alt)="([^"\n]*)"/g)) {
        if (match[1].includes('${')) continue;
        decoder.innerHTML = match[1];
        if (!known.has(decoder.value)) missing.push(`${file}: ${decoder.value}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('contains every literal passed to the explicit translation API', () => {
    const known = new Set<string>(sourceMessages);
    const missing: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(resolve(file), 'utf8'), ts.ScriptTarget.Latest, true);
      const extraHelpers = file.endsWith('/mask-editor.ts') ? ['control', 'slider']
        : file.endsWith('/layout-panel.ts') ? ['number', 'select', 'caption', 'button']
        : file.endsWith('/data-tools.ts') ? ['tr', 'report']
        : file.endsWith('/conversion-panel.ts') ? ['select'] : [];
      const secondArgumentHelpers = file.endsWith('/data-tools.ts') ? ['button', 'select', 'checkbox'] : [];
      for (const message of translationLiterals(source, file.startsWith('src/editor/'), extraHelpers, secondArgumentHelpers)) {
        if (!known.has(message)) missing.push(`${file}: ${message}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('checks panel captions and static option labels without translating document content', () => {
    const source = ts.createSourceFile('panel.ts', `
      const annotationLabels = { Text: 'Note', Ink: 'Drawing' };
      panelButton(resolved ? 'Reopen' : 'Resolve', save, t);
      panelInput(row, 'Comment', 'User-provided comment', t);
      api.registerDocumentAction('Forms', show);
      api.mountDocumentPanel('Annotations', mount);
      api.runPdfOperation('Update form', update);
      for (const [value, caption] of [['ces', 'Czech'], ['eng', 'English']]) {
        option.value = value; option.textContent = t(caption);
      }
      for (const [kind, caption] of [['x', 'Horizontal'], ['y', 'Vertical']] as const) {
        option.value = kind; option.textContent = t(caption);
      }
      for (const [caption, text] of [['Original text', page.beforeText], ['New text', page.afterText]]) {
        title.textContent = t(caption); area.value = text;
      }
      select('Mode', [['editable', 'Editable content'], ['format', 'DOCX']]);
      button(row, 'Prepare chart', save);
      checkbox(row, 'Allow overflow');
      report('Changes staged.');
      tr('Data set');
      const kindLabels = { inserted: 'Inserted page', unchanged: 'Unchanged' };
      title.textContent = t(kindLabels[page.kind]);
      legend.textContent = t(annotationLabels[annotation.subtype]);
      legend.textContent = field.name;
      option.textContent = field.options[0];
      input.value = annotation.contents;
      recognized.value = result.pages[0].text;
    `, ts.ScriptTarget.Latest, true);
    expect(translationLiterals(source, true, ['select', 'tr', 'report'], ['button', 'checkbox'])).toEqual([
      'Reopen', 'Resolve', 'Comment', 'Forms', 'Annotations', 'Update form',
      'Czech', 'English', 'Horizontal', 'Vertical', 'Original text', 'New text', 'Mode', 'Editable content', 'Prepare chart', 'Allow overflow', 'Changes staged.', 'Data set', 'Inserted page', 'Unchanged', 'Note', 'Drawing',
    ]);
  });
});
