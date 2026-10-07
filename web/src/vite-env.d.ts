/// <reference types="vite/client" />

// Build identity injected by Vite `define` (vite.config.ts) at build time.
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

declare module "*?chronicle-runtime-asset" {
  const url: string;
  export default url;
  export const packedWasmIdentity: null | {
    transport: "gzip";
    encodedBytes: number;
    decodedBytes: number;
    encodedSha256: string;
    decodedSha256: string;
  };
}

// True only in a test build (CHRONICLE_E2E_TEST_HOOKS=1); see src/lib/testHooks.ts.
declare const __CHRONICLE_TEST_HOOKS__: boolean;
