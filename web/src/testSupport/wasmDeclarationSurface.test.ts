import { describe, expect, it } from "vitest";

import {
  assertDeclarationSurface,
  declarationSurface,
} from "../../scripts/wasm_declaration_surface.mjs";

const DECLARATION = `
export class RuntimeHandle {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  artifact_metadata_json(index: number): string;
  manifest_json(): string;
  take_artifact_bytes(index: number): Uint8Array;
  readonly artifact_count: number;
}
export function execute_workspace(): RuntimeHandle;
export default function __wbg_init(module?: InitInput): Promise<InitOutput>;
`;

describe("WASM declaration surface", () => {
  it("captures constructor visibility, methods, disposal, and readonly properties", () => {
    expect(declarationSurface(DECLARATION)).toEqual({
      topLevel: ["class:RuntimeHandle", "function:execute_workspace"],
      classes: {
        RuntimeHandle: [
          "constructor:private constructor();",
          "method:[Symbol.dispose](): void;",
          "method:artifact_metadata_json(index: number): string;",
          "method:free(): void;",
          "method:manifest_json(): string;",
          "method:take_artifact_bytes(index: number): Uint8Array;",
          "readonly:readonly artifact_count: number;",
        ],
      },
      functions: {
        execute_workspace:
          "export function execute_workspace(): RuntimeHandle;",
      },
      defaultFunction:
        "export default function __wbg_init(module?: InitInput): Promise<InitOutput>;",
    });
  });

  it("makes missing, renamed, or widened class members visible to the comparison", () => {
    const expected = declarationSurface(DECLARATION);
    const widened = DECLARATION.replace("private constructor();", "constructor();");
    const renamed = DECLARATION.replace("manifest_json", "manifest_json_v2");
    const mutable = DECLARATION.replace("readonly artifact_count", "artifact_count");
    const changedParameter = DECLARATION.replace(
      "execute_workspace()",
      "execute_workspace(request: string)",
    );
    const changedReturn = DECLARATION.replace(
      "execute_workspace(): RuntimeHandle",
      "execute_workspace(): any",
    );
    const changedInitializer = DECLARATION.replace(
      "module?: InitInput",
      "module: InitInput",
    );

    expect(() => assertDeclarationSurface("fixture", widened, expected)).toThrow(
      "exported class surface drifted",
    );
    expect(() => assertDeclarationSurface("fixture", renamed, expected)).toThrow(
      "exported class surface drifted",
    );
    expect(() => declarationSurface(mutable)).toThrow(
      "unsupported public declaration member",
    );
    expect(() =>
      assertDeclarationSurface("fixture", changedParameter, expected),
    ).toThrow("exported function signatures drifted");
    expect(() => assertDeclarationSurface("fixture", changedReturn, expected)).toThrow(
      "exported function signatures drifted",
    );
    expect(() =>
      assertDeclarationSurface("fixture", changedInitializer, expected),
    ).toThrow("default initializer signature drifted");
  });

  it("rejects a missing top-level export through the production comparison", () => {
    const expected = declarationSurface(DECLARATION);
    const missing = DECLARATION.replace(
      "export function execute_workspace(): RuntimeHandle;",
      "",
    );
    expect(() => assertDeclarationSurface("fixture", missing, expected)).toThrow(
      "export surface drifted",
    );
  });
});
