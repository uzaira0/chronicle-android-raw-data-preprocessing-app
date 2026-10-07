import type { TooltipContent } from "@/components/Tooltip";
import { BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";

export const TOOLTIPS = {
  ...BROWSER_OPTION_TOOLTIPS,
  openerSet: {
    title: "App-episode opener set",
    body:
      "Chooses which retained, app-scoped rows may begin an episode without deleting rows " +
      "needed as closers or device-state evidence. GESIS app-scoped starts is a GESIS-derived " +
      "adapter, not a verbatim source method; package handling remains with reconstruction and " +
      "the separate package-policy axis.",
  },
  runMode: {
    title: "Process files",
    body: "Runs the preprocessing pipeline on your uploaded raw Chronicle CSV files.",
  },
} as const satisfies Record<string, TooltipContent>;
