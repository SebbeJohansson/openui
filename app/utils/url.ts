/** Strip trailing slashes so paths can be appended with a single `/`. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
