import type { TooltipContent } from "@/components/Tooltip";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";

export const TOOLTIPS = {
  ...BROWSER_OPTION_TOOLTIPS,
  runMode: {
    title: "Process files",
    body: "Runs the preprocessing pipeline on your uploaded raw Chronicle CSV files.",
  },
} as const satisfies Record<string, TooltipContent>;

export type TooltipKey = keyof typeof TOOLTIPS;

export function tooltipFor(key: TooltipKey): TooltipContent {
  return TOOLTIPS[key];
}
