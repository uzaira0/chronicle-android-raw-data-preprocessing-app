/**
 * @param {string} declaration
 * @param {string} className
 */
function classBody(declaration, className) {
  const marker = `export class ${className} {`;
  const start = declaration.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  const bodyStart = start + marker.length;
  for (let index = start + marker.indexOf("{"); index < declaration.length; index += 1) {
    const character = declaration[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return declaration.slice(bodyStart, index);
    }
  }
  throw new Error(`unterminated declaration for class ${className}`);
}

/** @param {string} line */
function normalizedMember(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("/**") || trimmed.startsWith("*") || trimmed === "*/") {
    return null;
  }
  if (trimmed === "private constructor();") return "constructor:private constructor();";
  if (trimmed === "constructor();") return "constructor:constructor();";
  if (trimmed.startsWith("readonly ")) return `readonly:${trimmed}`;
  if (/^(?:\[Symbol\.dispose\]|[A-Za-z0-9_]+)\([^)]*\):/.test(trimmed)) {
    return `method:${trimmed}`;
  }
  throw new Error(`unsupported public declaration member: ${trimmed}`);
}

/** @param {string} declaration */
export function declarationSurface(declaration) {
  const topLevel = [...declaration.matchAll(/^export (class|function) ([A-Za-z0-9_]+)/gm)]
    .map((match) => `${match[1]}:${match[2]}`)
    .sort();
  const classes = Object.fromEntries(
    topLevel
      .filter((entry) => entry.startsWith("class:"))
      .map((entry) => entry.slice("class:".length))
      .map((className) => {
        const body = classBody(declaration, className);
        if (body === null) throw new Error(`missing declaration for class ${className}`);
        return [
          className,
          body
            .split("\n")
            .map(normalizedMember)
            .filter((member) => member !== null)
            .sort(),
        ];
      }),
  );
  const functions = Object.fromEntries(
    [...declaration.matchAll(/^export function ([A-Za-z0-9_]+)([^\r\n]*);$/gm)].map(
      (match) => {
        const name = match[1];
        const tail = match[2];
        if (name === undefined || tail === undefined) {
          throw new Error("malformed exported function declaration");
        }
        return [
          name,
          `export function ${name}${tail.replace(/\s+/g, " ").trimEnd()};`,
        ];
      },
    ),
  );
  const functionNames = topLevel
    .filter((entry) => entry.startsWith("function:"))
    .map((entry) => entry.slice("function:".length))
    .sort();
  if (JSON.stringify(Object.keys(functions).sort()) !== JSON.stringify(functionNames)) {
    throw new Error("every exported function must have one exact single-declaration signature");
  }
  const defaultMatches = [
    ...declaration.matchAll(/^export default function ([A-Za-z0-9_]+)\s*([^\r\n]*);$/gm),
  ];
  if (defaultMatches.length !== 1) {
    throw new Error("WASM declaration must expose exactly one default initializer");
  }
  const defaultName = defaultMatches[0]?.[1];
  const defaultTail = defaultMatches[0]?.[2];
  if (defaultName === undefined || defaultTail === undefined) {
    throw new Error("malformed default initializer declaration");
  }
  const defaultFunction = `export default function ${defaultName}${defaultTail
    .replace(/\s+/g, " ")
    .trimEnd()};`;
  return { topLevel, classes, functions, defaultFunction };
}

/**
 * @param {string} packageName
 * @param {string} declaration
 * @param {{topLevel: string[], classes: Record<string, string[]>, functions: Record<string, string>, defaultFunction: string}} expected
 */
export function assertDeclarationSurface(packageName, declaration, expected) {
  const actual = declarationSurface(declaration);
  if (JSON.stringify(actual.topLevel) !== JSON.stringify([...expected.topLevel].sort())) {
    throw new Error(
      `${packageName} export surface drifted.\n` +
        `expected=${[...expected.topLevel].sort().join(",")}\n` +
        `actual=${actual.topLevel.join(",")}`,
    );
  }
  if (JSON.stringify(actual.classes) !== JSON.stringify(expected.classes)) {
    throw new Error(
      `${packageName} exported class surface drifted.\n` +
        `expected=${JSON.stringify(expected.classes)}\n` +
        `actual=${JSON.stringify(actual.classes)}`,
    );
  }
  /** @param {Record<string, string>} functions */
  const sortedFunctions = (functions) =>
    Object.fromEntries(Object.entries(functions).sort(([left], [right]) => left.localeCompare(right)));
  if (
    JSON.stringify(sortedFunctions(actual.functions)) !==
    JSON.stringify(sortedFunctions(expected.functions))
  ) {
    throw new Error(
      `${packageName} exported function signatures drifted.\n` +
        `expected=${JSON.stringify(expected.functions)}\n` +
        `actual=${JSON.stringify(actual.functions)}`,
    );
  }
  if (actual.defaultFunction !== expected.defaultFunction) {
    throw new Error(
      `${packageName} default initializer signature drifted.\n` +
        `expected=${expected.defaultFunction}\nactual=${actual.defaultFunction}`,
    );
  }
}
