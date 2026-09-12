// reads from Chrome's own favicon cache by URL, works even for tabs closed long ago,
// falls back to a generic icon if nothing's cached - no fetching or storage needed on our end
export function getFaviconUrl(pageUrl: string, size = 32): string {
  // built from runtime.id instead of runtime.getURL, since _favicon isn't a declared WXT entrypoint
  const url = new URL(`chrome-extension://${browser.runtime.id}/_favicon/`);
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}
