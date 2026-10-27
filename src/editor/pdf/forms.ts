import { PDFArray, PDFCheckBox, PDFDict, PDFDropdown, PDFField, PDFHexString, PDFName, PDFOptionList, PDFParser, PDFRadioGroup, PDFString, PDFTextField, type PDFDocument, type PDFFont, type PDFObject } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { loadNavigationDocument } from './navigation';
import type { FormChange, FormField, FormValue } from './form-types';

export class PdfStandardError extends Error { constructor(public readonly code: 'invalid-change' | 'unsupported-structure' | 'limit-exceeded' | 'font-unavailable') { super(code); this.name = 'PdfStandardError'; } }
export function standardFail(code: ConstructorParameters<typeof PdfStandardError>[0]): never { throw new PdfStandardError(code); }
export async function loadStandardDocument(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await loadNavigationDocument(bytes);
  // Inspect every reachable indirect dictionary, including nested direct action dictionaries.
  const seen = new Set<object>();
  const inspect = (value: unknown, depth: number) => {
    if (!(value instanceof PDFDict || value instanceof PDFArray) || seen.has(value)) return;
    if (depth > 64 || seen.size > 100000) standardFail('limit-exceeded'); seen.add(value);
    if (value instanceof PDFDict) {
      if (['XFA', 'JS', 'JavaScript', 'AA'].some(k => value.has(PDFName.of(k)))) standardFail('unsupported-structure');
      const action = value.get(PDFName.of('S')); if (action instanceof PDFName && ['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'Rendition'].includes(action.decodeText())) standardFail('unsupported-structure');
      for (const [, child] of value.entries()) inspect(child, depth + 1);
    } else for (const child of value.asArray()) inspect(child, depth + 1);
  };
  for (const [, value] of doc.context.enumerateIndirectObjects()) inspect(value, 0);
  return doc;
}
export function validateRect(doc: PDFDocument, pageIndex: number, rect: readonly number[]): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount() || rect.length !== 4 || rect.some(v => !Number.isFinite(v))) standardFail('invalid-change');
  const [x, y, w, h] = rect, box = doc.getPage(pageIndex).getCropBox();
  if (w <= 0 || h <= 0 || x < box.x || y < box.y || x + w > box.x + box.width || y + h > box.y + box.height) standardFail('invalid-change');
}
function kind(field: PDFField): FormField['kind'] { return field instanceof PDFTextField ? 'text' : field instanceof PDFCheckBox ? 'checkbox' : field instanceof PDFRadioGroup ? 'radio' : field instanceof PDFDropdown || field instanceof PDFOptionList ? 'choice' : 'unsupported'; }
function value(field: PDFField): FormValue { return field instanceof PDFTextField ? field.getText() ?? '' : field instanceof PDFCheckBox ? field.isChecked() : field instanceof PDFRadioGroup ? field.getSelected() ?? '' : field instanceof PDFDropdown || field instanceof PDFOptionList ? field.getSelected() : ''; }
function list(doc: PDFDocument): FormField[] {
  if (!doc.catalog.has(PDFName.of('AcroForm'))) return [];
  const fields = doc.getForm().getFields(); if (fields.length > 5000) standardFail('limit-exceeded');
  const names = new Set<string>();
  return fields.map(field => {
    const name = field.getName(); if (names.has(name)) standardFail('unsupported-structure'); names.add(name);
    return { id: field.ref.toString(), name, kind: kind(field), value: value(field), options: field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList ? field.getOptions() : field instanceof PDFCheckBox ? [field.acroField.getOnValue()?.decodeText() ?? 'Yes'] : [], multiline:field instanceof PDFTextField && field.isMultiline(), multiSelect: field instanceof PDFDropdown || field instanceof PDFOptionList ? field.isMultiselect() : false, readOnly: field.isReadOnly(), required: field.isRequired(), widgets: field.acroField.getWidgets().map(widget => {
      const ref = doc.context.getObjectRef(widget.dict);
      const pageIndex = doc.getPages().findIndex(page => page.ref.toString() === widget.P()?.toString() || !!(ref && page.node.Annots()?.asArray().some(v => v.toString() === ref.toString())));
      const r = widget.getRectangle(); return { pageIndex, rect: [r.x, r.y, r.width, r.height] as [number, number, number, number] };
    }) };
  });
}
export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> { return list(await loadStandardDocument(bytes)); }
export async function applyFormChanges(bytes: Uint8Array, changes: readonly FormChange[], options: { fontBytes?: Uint8Array; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  changes = structuredClone(changes); options = { ...options, fontBytes: options.fontBytes?.slice() };
  const doc = await loadStandardDocument(bytes); list(doc);
  if (changes.length > 1000) standardFail('limit-exceeded');
  const form = doc.getForm(); let font: PDFFont | undefined;
  const getFont = async () => {
    if (!font) {
      let data = options.fontBytes;
      if (!data) { const response = await fetch('/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf', { signal: options.signal }); if (!response.ok) standardFail('font-unavailable'); data = new Uint8Array(await response.arrayBuffer()); }
      doc.registerFontkit(fontkit); font = await doc.embedFont(data, { subset: true });
    } return font;
  };
  for (const change of changes) {
    options.signal?.throwIfAborted();
    if (change.kind === 'tab-order') {
      if (!Number.isInteger(change.pageIndex) || change.pageIndex < 0 || change.pageIndex >= doc.getPageCount() || !['row', 'column'].includes(change.order)) standardFail('invalid-change');
      doc.getPage(change.pageIndex).node.set(PDFName.of('Tabs'), PDFName.of(change.order === 'row' ? 'R' : 'C')); continue;
    }
    if (change.kind === 'create') {
      if (!change.name.trim() || change.name.length > 200 || /[.\x00-\x1f]/.test(change.name) || form.getFields().some(f => f.getName() === change.name)) standardFail('invalid-change');
      validateRect(doc, change.pageIndex, change.rect); const [x, y, width, height] = change.rect, page = doc.getPage(change.pageIndex);
      const appearance = { x, y, width, height, borderWidth: 1 };
      let field: PDFField;
      if (change.fieldKind === 'text') { const f = form.createTextField(change.name); f.addToPage(page, { ...appearance, font: await getFont() }); field = f; }
      else if (change.fieldKind === 'checkbox') { const f = form.createCheckBox(change.name); f.addToPage(page, appearance); field = f; }
      else {
        const choices = change.options; if (!choices?.length || choices.length > 100 || choices.some(c => typeof c !== 'string' || !c || c.length > 200) || new Set(choices).size !== choices.length) standardFail('invalid-change');
        if (change.fieldKind === 'choice') { const supported = (await getFont()).getCharacterSet(); if (choices.some(choice => [...choice].some(c => !supported.includes(c.codePointAt(0)!)))) standardFail('invalid-change'); }
        if (change.fieldKind === 'radio') { const f = form.createRadioGroup(change.name); choices.forEach((choice, index) => { const rect = [x + index * (width + 4), y, width, height]; validateRect(doc, change.pageIndex, rect); f.addOptionToPage(choice, page, { ...appearance, x: rect[0] }); }); field = f; }
        else if (change.fieldKind === 'choice') { const f = form.createDropdown(change.name); f.addOptions(choices); f.addToPage(page, { ...appearance, font: await getFont() }); field = f; }
        else standardFail('invalid-change');
      }
      if (change.required) field.enableRequired();
      continue;
    }
    const field = form.getFields().find(f => f.ref.toString() === change.id); if (!field || kind(field) === 'unsupported') standardFail('invalid-change');
    if (change.kind === 'properties') { if (change.readOnly !== undefined) change.readOnly ? field.enableReadOnly() : field.disableReadOnly(); if (change.required !== undefined) change.required ? field.enableRequired() : field.disableRequired(); }
    else if (change.kind === 'remove') form.removeField(field);
    else if (change.kind === 'move') {
      const widget = field.acroField.getWidgets()[change.widgetIndex], item = list(doc).find(f => f.id === change.id)?.widgets[change.widgetIndex]; if (!widget || !item) standardFail('invalid-change');
      validateRect(doc, item.pageIndex, change.rect); const [x, y, width, height] = change.rect; widget.setRectangle({ x, y, width, height }); form.markFieldAsDirty(field.ref);
    } else if (change.kind === 'set-value') {
      if (field.isReadOnly()) standardFail('invalid-change');
      if (typeof change.value === 'string' && change.value.length > 10000) standardFail('limit-exceeded');
      if (field instanceof PDFTextField && typeof change.value === 'string') { const f = await getFont(); validateAppearanceText(f,change.value,true); field.setText(change.value); }
      else if (field instanceof PDFCheckBox && typeof change.value === 'boolean') change.value ? field.check() : field.uncheck();
      else if (field instanceof PDFRadioGroup && typeof change.value === 'string') { if (!change.value) field.clear(); else { if (!field.getOptions().includes(change.value)) standardFail('invalid-change'); field.select(change.value); } }
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) { const values = typeof change.value === 'string' ? [change.value] : change.value; if (!Array.isArray(values) || values.some(v => !field.getOptions().includes(v)) || (!field.isMultiselect() && values.length > 1)) standardFail('invalid-change'); if (!values.length) field.clear(); else field.select(values); await getFont(); }
      else standardFail('invalid-change');
    }
  }
  // Regeneration can be triggered by moving widgets or missing appearances, not only by setting values.
  for(const field of form.getFields())if(field.needsAppearancesUpdate()){
    if(field instanceof PDFTextField)validateAppearanceText(await getFont(),field.getText()??'',true);
    else if(field instanceof PDFDropdown||field instanceof PDFOptionList){const f=await getFont();for(const text of [...field.getOptions(),...field.getSelected()])validateAppearanceText(f,text);}
  }
  form.updateFieldAppearances(font); options.signal?.throwIfAborted(); return doc.save({ updateFieldAppearances: false });
}
function validateAppearanceText(font:PDFFont,text:string,multiline=false):void {const supported=new Set(font.getCharacterSet());if([...text].some(c=>!(multiline&&/[\r\n\t]/.test(c))&&!supported.has(c.codePointAt(0)!)))standardFail('invalid-change');}
export function exportFormValues(fields: readonly FormField[]): string { return JSON.stringify({ version: 1, fields: fields.filter(f=>f.kind!=='unsupported').map(f => ({ id: f.id, name: f.name, value: f.value })) }, null, 2); }
export function importFormValues(json: string, fields: readonly FormField[]): FormChange[] {
  if (json.length > 1024 * 1024) standardFail('limit-exceeded');
  const data = JSON.parse(json); if (data?.version !== 1 || !Array.isArray(data.fields) || data.fields.length > 5000) standardFail('invalid-change');
  const seen = new Set<string>(); return data.fields.flatMap((item: { id: string; name: string; value: FormValue }) => {
    const field = fields.find(f => f.id === item.id && f.name === item.name); if (!field || seen.has(field.id)||field.kind==='unsupported') standardFail('invalid-change'); seen.add(field.id);if(field.readOnly){if(JSON.stringify(field.value)!==JSON.stringify(item.value))standardFail('invalid-change');return [];} return [{ kind: 'set-value', id: field.id, value: item.value }];
  });
}
function formValueChanges(values: Array<{name:string;value:FormValue}>, fields: readonly FormField[]): FormChange[] {
  const seen = new Set<string>(); return values.flatMap(item => { const field = fields.find(f => f.name === item.name); if (!field || seen.has(field.id) || field.kind === 'unsupported') standardFail('invalid-change'); seen.add(field.id);
    let value = item.value;
    if (field.kind === 'checkbox') { if (value === (field.options[0] ?? 'Yes') || value === 'true') value = true; else if (value === 'Off' || value === 'false' || value === '') value = false; if (typeof value !== 'boolean') standardFail('invalid-change'); }
    if(field.readOnly){const normalized=Array.isArray(field.value)&&typeof value==='string'?[value]:value;if(JSON.stringify(field.value)!==JSON.stringify(normalized))standardFail('invalid-change');return [];}
    return [{kind:'set-value' as const,id:field.id,value}];
  });
}
function xmlEscape(value:string):string { return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]!); }
export function exportFormValuesXfdf(fields:readonly FormField[]):string {
  return `<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><fields>${fields.filter(f=>f.kind!=='unsupported').map(f=>`<field name="${xmlEscape(f.name)}">${(Array.isArray(f.value)?f.value:[typeof f.value==='boolean'?(f.value?(f.options[0]??'Yes'):'Off'):f.value]).map(v=>`<value>${xmlEscape(v)}</value>`).join('')}</field>`).join('')}</fields></xfdf>`;
}
export function importFormValuesXfdf(xml:string,fields:readonly FormField[]):FormChange[] {
  if(xml.length>1024*1024)standardFail('limit-exceeded');if(/<!DOCTYPE|<!ENTITY/i.test(xml))standardFail('invalid-change');
  const dom=new DOMParser().parseFromString(xml,'application/xml');if(dom.querySelector('parsererror')||dom.documentElement.localName!=='xfdf')standardFail('invalid-change');
  const groups=dom.getElementsByTagNameNS('*','fields');if(groups.length!==1)standardFail('invalid-change');const nodes=Array.from(groups[0].children);if(nodes.length>5000)standardFail('limit-exceeded');
  return formValueChanges(nodes.map(node=>{if(node.localName!=='field'||!node.hasAttribute('name')||Array.from(node.children).some(c=>c.localName!=='value'))standardFail('unsupported-structure');const values=Array.from(node.children).map(c=>c.textContent??'');return{name:node.getAttribute('name')!,value:values.length===1?values[0]:values};}),fields);
}
export function exportFormValuesFdf(fields:readonly FormField[]):string {
  const encoded=(v:string)=>PDFHexString.fromText(v).toString();
  const items=fields.filter(f=>f.kind!=='unsupported').map(f=>{const value=Array.isArray(f.value)?`[${f.value.map(encoded).join(' ')}]`:typeof f.value==='boolean'?PDFName.of(f.value?(f.options[0]??'Yes'):'Off').toString():encoded(f.value);return `<< /T ${encoded(f.name)} /V ${value} >>`;}).join('\n');
  return `%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [${items}] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
}
export async function importFormValuesFdf(data:Uint8Array,fields:readonly FormField[]):Promise<FormChange[]> {
  if(data.length>1024*1024)standardFail('limit-exceeded');const copy=data.slice();if(new TextDecoder().decode(copy.subarray(0,5))!=='%FDF-')standardFail('invalid-change');copy.set(new TextEncoder().encode('%PDF-'),0);
  const context=await PDFParser.forBytesWithOptions(copy,100,true).parseDocument();
  if(context.trailerInfo.Encrypt)standardFail('unsupported-structure');const root=context.lookup(context.trailerInfo.Root);if(!(root instanceof PDFDict)||root.keys().some(k=>k.decodeText()!=='FDF'))standardFail('unsupported-structure');
  const fdf=root.lookup(PDFName.of('FDF'));if(!(fdf instanceof PDFDict)||fdf.keys().some(k=>k.decodeText()!=='Fields'))standardFail('unsupported-structure');const array=fdf.lookup(PDFName.of('Fields'));if(!(array instanceof PDFArray)||array.size()>5000)standardFail('invalid-change');
  const decode=(raw:PDFObject):string=>{const v=context.lookup(raw);if(v instanceof PDFString||v instanceof PDFHexString||v instanceof PDFName)return v.decodeText();return standardFail('unsupported-structure');};
  return formValueChanges(array.asArray().map(raw=>{const item=context.lookup(raw);if(!(item instanceof PDFDict)||item.keys().some(k=>!['T','V'].includes(k.decodeText())))standardFail('unsupported-structure');const name=item.get(PDFName.of('T')),rawValue=item.get(PDFName.of('V'));if(!name||!rawValue)standardFail('invalid-change');const v=context.lookup(rawValue);return{name:decode(name),value:v instanceof PDFArray?v.asArray().map(decode):decode(rawValue)};}),fields);
}
