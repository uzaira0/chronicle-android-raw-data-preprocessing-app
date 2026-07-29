import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSwCaches, clearSwCachesAndReload } from "./swCache";

function stubCaches(keys: string[]): { deleted: string[] } {
  const deleted: string[] = [];
  vi.stubGlobal("caches", {
    keys: () => Promise.resolve(keys),
    delete: (key: string) => {
      deleted.push(key);
      return Promise.resolve(true);
    },
  });
  return { deleted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clearSwCaches", () => {
  it("deletes every cache and unregisters every service worker", async () => {
    const { deleted } = stubCaches(["assets-v1", "assets-v2"]);
    const unregister = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: () => Promise.resolve([{ unregister }, { unregister }]),
      },
    });

    await clearSwCaches();

    expect(deleted).toEqual(["assets-v1", "assets-v2"]);
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it("still clears caches when serviceWorker is unavailable", async () => {
    const { deleted } = stubCaches(["assets-v1"]);
    vi.stubGlobal("navigator", {});

    await clearSwCaches();

    expect(deleted).toEqual(["assets-v1"]);
  });
});

describe("clearSwCachesAndReload", () => {
  it("reloads only after caches and registrations are gone", async () => {
    const order: string[] = [];
    vi.stubGlobal("caches", {
      keys: () => Promise.resolve(["assets-v1"]),
      delete: () => {
        order.push("cache-delete");
        return Promise.resolve(true);
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: () =>
          Promise.resolve([
            {
              unregister: () => {
                order.push("unregister");
                return Promise.resolve(true);
              },
            },
          ]),
      },
    });
    const reload = vi.fn(() => order.push("reload"));
    vi.stubGlobal("window", { location: { reload } });

    await clearSwCachesAndReload();

    expect(order).toEqual(["cache-delete", "unregister", "reload"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
