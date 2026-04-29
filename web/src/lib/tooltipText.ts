import type { TooltipContent } from "@/components/Tooltip";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";

export const TOOLTIPS = {
  ...BROWSER_OPTION_TOOLTIPS,
  runMode: {
    title: "Process files",
    body: "Runs the preprocessing pipeline on your uploaded raw Chronicle CSVs. The demo card on the top-right runs the same pipeline on a built-in sample so you can demo the output without uploading anything.",
  },
} as const satisfies Record<string, TooltipContent>;

export type TooltipKey = keyof typeof TOOLTIPS;

export function tooltipFor(key: TooltipKey): TooltipContent {
  return TOOLTIPS[key];
}
