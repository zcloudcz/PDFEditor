import { mountComparisonPanel } from './comparison-panel';
import { mountMeasurementPanel } from './measurement-panel';
import type { StandardPdfToolsApi } from './standard-tools';

export interface ComparisonToolsApi extends StandardPdfToolsApi {
  readComparisonSnapshot?: StandardPdfToolsApi['readPdfSnapshot'];
}
export function setupComparisonTools(api: ComparisonToolsApi): void {
  api.registerDocumentAction('Porovnat PDF',()=>api.mountDocumentPanel('Porovnat PDF',body=>mountComparisonPanel(body,{ ...api, readPdfSnapshot: api.readComparisonSnapshot ?? api.readPdfSnapshot })));
  api.registerDocumentAction('Měření PDF',()=>api.mountDocumentPanel('Měření PDF',(body,close)=>mountMeasurementPanel(body,api,close)));
}
