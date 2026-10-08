import { inject } from "vitest";

import { LINKML_UVX_ARGS } from "./linkmlPythonGlobalSetup";

// Path to the Python interpreter that linkmlPythonGlobalSetup resolved once
// for this run. Call it with the script arguments that follow `python`.
export function linkmlPython(): string {
  const python = inject("linkmlPython");
  if (!python) {
    throw new Error("linkml python was not resolved: the vitest globalSetup src/testSupport/linkmlPythonGlobalSetup.ts"
      + " did not run or uvx could not provide " + LINKML_UVX_ARGS.slice(0, 4).join(" "));
  }
  return python;
}
