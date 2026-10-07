const bundledAssetCache = new Map<string, Promise<ArrayBuffer>>();

/**
 * Fetch a build-bundled asset once per worker/page, while allowing a transient
 * failure to be retried instead of poisoning the cache for the session.
 */
export async function fetchBundledAssetBytes(url: string): Promise<ArrayBuffer> {
  const cached = bundledAssetCache.get(url);
  if (cached) return cached;
  const pending = fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`failed to load bundled asset (${response.status}): ${url}`);
    }
    return response.arrayBuffer();
  });
  // Forget a failed fetch so the next caller retries it; the caller of this
  // one still receives the rejection through `pending`.
  pending.catch(() => {
    bundledAssetCache.delete(url);
  });
  bundledAssetCache.set(url, pending);
  return pending;
}
