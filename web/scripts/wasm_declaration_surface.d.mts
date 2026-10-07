export function declarationSurface(declaration: string): {
  topLevel: string[];
  classes: Record<string, string[]>;
  functions: Record<string, string>;
  defaultFunction: string;
};

export function assertDeclarationSurface(
  packageName: string,
  declaration: string,
  expected: {
    topLevel: string[];
    classes: Record<string, string[]>;
    functions: Record<string, string>;
    defaultFunction: string;
  },
): void;
