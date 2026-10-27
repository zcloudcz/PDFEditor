import { applyAnnotationChanges, exportAnnotationsXfdf, importAnnotationsXfdf, readAnnotations } from './annotations';
import type { AnnotationChange, AnnotationKind } from './annotation-types';
import { pickPdfPlacement } from './placement';
import { pickPdfTextSelection, type PdfTextSelection } from './text-selection';
import { downloadStandardFile, panelButton, panelCloseGuard, panelInput, showStandardFailure, type StandardPdfToolsApi } from './standard-tools';
export function mountAnnotationPanel(body: HTMLElement, api: StandardPdfToolsApi,close:()=>void=()=>{}): () => void {
  const t = api.t ?? ((s: string): string => s); let alive = true, busy = false;
  const status = document.createElement('p'); status.setAttribute('role','status'); const content = document.createElement('div');content.className='studio-page-manager'; body.append(status, content);
  const guard=panelCloseGuard(body);
  const run = async (operation: () => Promise<void>) => { if (busy||!alive) return; busy = true;guard.setBusy(true); content.inert = true; body.setAttribute('aria-busy','true'); try { await operation(); } catch { if (alive) status.textContent = t('Operace se nezdařila.'); } finally { busy = false;guard.setBusy(false); content.inert = false; body.removeAttribute('aria-busy'); } };
  const refresh = async () => {
    const snapshot = await api.readPdfSnapshot(), annotations = await readAnnotations(snapshot.bytes); if (!alive) return; content.replaceChildren(); status.textContent = t('Souřadnice používají původní prostor PDF v bodech.');
    const apply = (changes: AnnotationChange[]): void => { void run(async () => { await api.runPdfOperation('PDF komentáře', (bytes, signal) => applyAnnotationChanges(bytes, changes, signal), snapshot.revision); await refresh(); }); };
    for (const annotation of annotations) {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `${annotation.pageIndex+1} · ${t(annotationLabels[annotation.subtype])}${annotation.resolved ? ' ✓' : ''}`; row.append(legend); content.append(row);
      const contents = panelInput(row, 'Komentář', annotation.contents, t);
      if (annotation.subtype !== 'Stamp') row.append(panelButton('Uložit komentář', () => apply([{ kind:'comment', id:annotation.id, contents:contents.value }]), t));
      row.append(panelButton('Odpovědět', () => apply([{ kind:'add', annotation:{ pageIndex:annotation.pageIndex, subtype:'Text', rect:annotation.rect, contents:contents.value, replyTo:annotation.id } }]), t), panelButton(annotation.resolved ? 'Znovu otevřít' : 'Vyřešit', () => apply([{ kind:'resolve', id:annotation.id, resolved:!annotation.resolved }]), t), panelButton('Smazat komentář', () => apply([{ kind:'remove', id:annotation.id }]), t));
    }
    const create = document.createElement('fieldset'); content.append(create); const page = panelInput(create,'Stránka','1',t,'number'), rect = panelInput(create,'Obdélník PDF v bodech (x,y,šířka,výška)','40,40,150,24',t), contents = panelInput(create,'Komentář','',t), paths = panelInput(create,'Body inkoustu (x,y,x,y; další tah)','40,40,100,60',t);
    const subtype = document.createElement('select'); subtype.setAttribute('aria-label', t('Typ anotace')); for (const value of ['Text','Highlight','Underline','StrikeOut','Ink','Stamp'] as AnnotationKind[]) { const o = document.createElement('option'); o.value = value; o.textContent = t(annotationLabels[value]); subtype.append(o); } create.append(subtype);
    const isMarkup = (): boolean => ['Highlight','Underline','StrikeOut'].includes(subtype.value);
    const place = (): void => {
      const getSurface = api.getPageSurface; if (!getSurface) return;
      const type = subtype.value as AnnotationKind, text = contents.value, markup = isMarkup();
      close(); void (async () => {
        let failed = false;
        try {
          let placement: PdfTextSelection | null, inkPaths: number[][] | undefined;
          if (markup) placement = await pickPdfTextSelection(snapshot.bytes, getSurface, undefined, t('Vyberte text na stránce. Enter potvrdí výběr, Escape zruší akci.'));
          else {
            const picked = await pickPdfPlacement(snapshot.bytes, getSurface, type === 'Text' ? 'note' : type === 'Ink' ? 'ink' : 'rectangle', undefined, t('Umístěte prvek na stránku. Escape zruší akci.'));
            placement = picked; if (type === 'Ink') inkPaths = picked?.inkPaths;
          }
          if (placement) await api.runPdfOperation('PDF komentáře', (bytes, signal) => applyAnnotationChanges(bytes, [{ kind: 'add', annotation: {
            pageIndex: placement.pageIndex, subtype: type, contents: text, rect: placement.rect,
            quadPoints: markup ? placement.quadPoints : undefined,
            inkPaths,
          } }], signal), snapshot.revision);
        } catch { failed = true; }
        finally { api.mountDocumentPanel('PDF komentáře', (next, nextClose) => { const cleanup = mountAnnotationPanel(next, api, nextClose); if (failed) showStandardFailure(next, t); return cleanup; }); }
      })();
    };
    const createButton = panelButton('Vytvořit anotaci', () => {
      if (isMarkup()) { place(); return; }
      const r = rect.value.split(',').map(Number) as [number,number,number,number];
      apply([{ kind:'add', annotation:{ pageIndex:Number(page.value)-1, subtype:subtype.value as AnnotationKind, rect:r, contents:contents.value, inkPaths:subtype.value === 'Ink' ? paths.value.split(';').map(p=>p.split(',').map(Number)) : undefined } }]);
    },t);
    const updateControls = (): void => { page.disabled = rect.disabled = isMarkup(); createButton.disabled = isMarkup() && !api.getPageSurface; };
    subtype.addEventListener('change', updateControls); updateControls(); create.append(createButton);
    if(api.getPageSurface)create.append(panelButton('Umístit na stránku', place, t));
    content.append(panelButton('Export komentářů XFDF',()=>downloadStandardFile(exportAnnotationsXfdf(annotations),'application/vnd.adobe.xfdf','comments.xfdf'),t));
    const upload = panelInput(content,'Import komentářů XFDF','',t,'file'); upload.accept = '.xfdf,application/vnd.adobe.xfdf'; upload.addEventListener('change',()=>void run(async()=>{ const file=upload.files?.[0]; if(!file)return;if(file.size>2*1024*1024)throw new Error('limit-exceeded'); const changes=importAnnotationsXfdf(await file.text()); await api.runPdfOperation('PDF komentáře',(bytes,signal)=>applyAnnotationChanges(bytes,changes,signal),snapshot.revision); await refresh(); }));
  };
  void run(refresh); return()=>{ alive=false;guard.dispose(); };
}
const annotationLabels:Record<AnnotationKind,string>={Text:'Poznámka',Highlight:'Zvýraznění',Underline:'Podtržení',StrikeOut:'Přeškrtnutí',Ink:'Kresba',Stamp:'Razítko'};


