/** Redaction output uses a closed retained-object schema: standard 14 Type1 fonts,
 * simple 8-bit DeviceRGB/DeviceGray lossless images, paths and bounded Forms.
 * removeMetadata also removes page thumbnails, language, page labels and viewer
 * preferences. Unknown retained fields and nonstandard font/image data are refused.
 * Embedded fonts, ICC profiles, custom encodings and arbitrary PDF extensions are
 * unsupported. This is not a guarantee against steganography in visible content. */
export interface SanitizationPolicy {
  readonly removeMetadata: true;
  readonly removeAnnotations: true;
  readonly removeAttachments: true;
  readonly removeNamedData: true;
}

export const STRICT_SANITIZATION: SanitizationPolicy = Object.freeze({
  removeMetadata: true,
  removeAnnotations: true,
  removeAttachments: true,
  removeNamedData: true,
});

