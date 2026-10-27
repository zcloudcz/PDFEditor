import type { StandardPdfToolsApi } from './standard-tools';
import { mountDocumentPropertiesPanel } from './document-properties-panel';
import { mountAttachmentsPanel } from './attachments-panel';

export function setupStructureTools(api: StandardPdfToolsApi): void {
  api.registerDocumentAction('Vlastnosti PDF', () => api.mountDocumentPanel('Vlastnosti PDF', body => mountDocumentPropertiesPanel(body, api)));
  api.registerDocumentAction('Přílohy PDF', () => api.mountDocumentPanel('Přílohy PDF', body => mountAttachmentsPanel(body, api)));
}
