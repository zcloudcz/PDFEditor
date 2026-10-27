import { ConversionError, type ConversionResult } from './conversion-profile';
export type OfficeInputFormat = 'docx'|'xlsx'|'pptx';
/** Isolation boundary: no approved browser Office engine is currently packaged. Never uploads. */
export async function importOffice(_input: Blob, _format: OfficeInputFormat, signal: AbortSignal): Promise<ConversionResult> {
  signal.throwIfAborted(); throw new ConversionError('local-office-engine-unavailable');
}
