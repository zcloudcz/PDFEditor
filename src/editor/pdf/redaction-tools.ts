import { mountRedactionPanel, type RedactionToolsApi } from './redaction-panel';
/** Registration remains an integration gate; importing this module enables nothing. */
export function setupRedactionTools(api: RedactionToolsApi): void {
  api.registerDocumentAction('Redakce PDF', () => api.mountDocumentPanel('Redakce PDF', (body, close) => mountRedactionPanel(body, api, close)));
}
