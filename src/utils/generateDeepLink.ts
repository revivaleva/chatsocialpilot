export type DeepLinkOpts = {
  name: string;
  url?: string;
};

/**
 * Generate a mycontainers:// deep link.
 * - Always uses query-style format for better compatibility with non-ASCII characters (e.g., Japanese).
 * - If only name is provided, returns: mycontainers://?name=...
 * - If url is provided, returns: mycontainers://?name=...&url=...
 *
 * Throws if name is missing/empty.
 */
export function generateDeepLink(opts: DeepLinkOpts): string {
  const name = (opts && opts.name) ? String(opts.name).trim() : '';
  const url = opts && opts.url ? String(opts.url).trim() : '';
  if (!name) throw new Error('generateDeepLink: name is required');

  const encodedName = encodeURIComponent(name);
  if (!url) {
    // query-style (changed from host-style for better Japanese character support)
    return `mycontainers://?name=${encodedName}`;
  }
  const encodedUrl = encodeURIComponent(url);
  return `mycontainers://?name=${encodedName}&url=${encodedUrl}`;
}


