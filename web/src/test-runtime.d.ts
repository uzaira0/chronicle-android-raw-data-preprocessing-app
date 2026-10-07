import type { BrowserProcessingRuntime } from "@/lib/types";

declare global {
  interface Window {
    __CHRONICLE_TEST_RUNTIME__?: BrowserProcessingRuntime;
    __CHRONICLE_BENCHMARK_PAYLOAD_BUDGET_BYTES__?: number;
  }
}

export {};
