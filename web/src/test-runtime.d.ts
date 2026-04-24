import type { BrowserProcessingRuntime } from "@/lib/types";

declare global {
  interface Window {
    __CHRONICLE_TEST_RUNTIME__?: BrowserProcessingRuntime;
  }
}

export {};
