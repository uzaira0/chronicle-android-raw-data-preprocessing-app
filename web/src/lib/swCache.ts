export async function clearSwCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  const registrations = await navigator.serviceWorker?.getRegistrations() ?? [];
  await Promise.all(registrations.map((reg) => reg.unregister()));
}

export async function clearSwCachesAndReload(): Promise<void> {
  await clearSwCaches();
  window.location.reload();
}
