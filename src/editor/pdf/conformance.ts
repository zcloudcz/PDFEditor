export type ConformanceProfile = 'ordinary-pdf' | 'pdfa-2b' | 'pdfx-4';
export interface ConformanceResult {
  profile: ConformanceProfile;
  status: 'not-requested' | 'unavailable';
  reason?: 'independent-validator-unavailable';
}
/** No audited independent validator/converter is shipped. Metadata never establishes conformance. */
export async function validateConformance(_bytes: Uint8Array, profile: ConformanceProfile): Promise<ConformanceResult> {
  if (!['ordinary-pdf', 'pdfa-2b', 'pdfx-4'].includes(profile)) throw new Error('invalid-profile');
  return profile === 'ordinary-pdf' ? { profile, status: 'not-requested' } : { profile, status: 'unavailable', reason: 'independent-validator-unavailable' };
}
