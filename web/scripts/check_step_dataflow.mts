/**
 * Static AST verification of the step wiring (runs in check:contract).
 *
 * The wiring objects in src/lib/pipelineGraph/steps/ are the executable SSOT
 * for the step DAG. This script closes the remaining drift channels that the
 * type system and the runtime runner cannot see, by parsing the source with
 * the TypeScript compiler API and enforcing:
 *
 *  1. Every step's `run` body receives its dataflow ONLY through the declared
 *     `inputs`: the destructured parameter names must equal the input keys
 *     exactly (a non-destructured param is allowed only when `inputs` is {}).
 *  2. No step `run` body closes over another step or wiring constant — all
 *     cross-step dataflow must be a declared input reference.
 *  3. Every pipeline node in graphDef.ts executes through `runUnit` with
 *     exactly the wiring whose unit matches the node id, and references no
 *     other unit's wiring.
 *  4. `runUnit` is invoked nowhere else in src/ (no side-channel execution).
 *
 * Deterministic and purely syntactic — no LLM judgment, no type checker.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "src");
const STEPS_DIR = path.join(ROOT, "src", "lib", "pipelineGraph", "steps");
const GRAPH_DEF = path.join(ROOT, "src", "lib", "pipelineGraph", "graphDef.ts");
const RUNNER_FILE = path.join(ROOT, "src", "lib", "pipelineGraph", "stepRunner.ts");

const errors: string[] = [];

function fail(sourceFile: ts.SourceFile, node: ts.Node, message: string): void {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  errors.push(`${path.relative(ROOT, sourceFile.fileName)}:${line + 1} ${message}`);
}

function parse(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function objectProp(
  literal: ts.ObjectLiteralExpression,
  key: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find((prop) => {
    if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
      return propName(prop.name) === key;
    }
    if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text === key;
    return false;
  });
}

function functionOfProp(prop: ts.ObjectLiteralElementLike | undefined):
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.MethodDeclaration
  | null {
  if (!prop) return null;
  if (ts.isMethodDeclaration(prop)) return prop;
  if (ts.isPropertyAssignment(prop)) {
    const init = prop.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  }
  return null;
}

/** True when this Identifier node is a value REFERENCE (not a name/label position). */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isTypeReferenceNode(parent)) return false;
  if (ts.isQualifiedName(parent)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pass 1 — collect declarations from the steps modules.
// ---------------------------------------------------------------------------

interface StepDecl {
  constName: string;
  unit: string;
  id: string;
  inputKeys: string[];
  runFn: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;
  sourceFile: ts.SourceFile;
  specNode: ts.ObjectLiteralExpression;
}

const stepFiles = readdirSync(STEPS_DIR)
  .filter((name) => name.endsWith(".ts") && name !== "index.ts")
  .sort()
  .map((name) => path.join(STEPS_DIR, name));

const stepDecls: StepDecl[] = [];
/** wiring const name -> unit id (from wireUnit/wireUnitWhole first arg). */
const wiringUnits = new Map<string, string>();

for (const filePath of stepFiles) {
  const sourceFile = parse(filePath);
  /** local factory const name -> unit (from stepsOf("unit")). */
  const factories = new Map<string, string>();

  const visitTopLevel = (statement: ts.Statement): void => {
    if (!ts.isVariableStatement(statement)) return;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = decl.initializer;
      if (!ts.isCallExpression(init)) continue;
      const callee = init.expression;
      if (ts.isIdentifier(callee) && callee.text === "stepsOf") {
        const arg = init.arguments[0];
        if (arg && ts.isStringLiteral(arg)) factories.set(decl.name.text, arg.text);
        continue;
      }
      if (ts.isIdentifier(callee) && (callee.text === "wireUnit" || callee.text === "wireUnitWhole")) {
        const arg = init.arguments[0];
        if (arg && ts.isStringLiteral(arg)) wiringUnits.set(decl.name.text, arg.text);
        continue;
      }
      if (ts.isIdentifier(callee) && factories.has(callee.text)) {
        const spec = init.arguments[0];
        if (!spec || !ts.isObjectLiteralExpression(spec)) {
          fail(sourceFile, init, `step call "${decl.name.text}" must pass an inline object literal spec`);
          continue;
        }
        const idProp = objectProp(spec, "id");
        const id =
          idProp && ts.isPropertyAssignment(idProp) && ts.isStringLiteral(idProp.initializer)
            ? idProp.initializer.text
            : null;
        if (!id) {
          fail(sourceFile, spec, `step "${decl.name.text}" must declare a string-literal id`);
          continue;
        }
        const inputsProp = objectProp(spec, "inputs");
        if (
          !inputsProp ||
          !ts.isPropertyAssignment(inputsProp) ||
          !ts.isObjectLiteralExpression(inputsProp.initializer)
        ) {
          fail(sourceFile, spec, `step "${id}" must declare inputs as an inline object literal`);
          continue;
        }
        const inputKeys: string[] = [];
        for (const inputEntry of inputsProp.initializer.properties) {
          const key = ts.isPropertyAssignment(inputEntry) || ts.isShorthandPropertyAssignment(inputEntry)
            ? propName(inputEntry.name)
            : null;
          if (key === null) {
            fail(sourceFile, inputEntry, `step "${id}" has a non-static input key`);
            continue;
          }
          inputKeys.push(key);
        }
        const runFn = functionOfProp(objectProp(spec, "run"));
        if (!runFn) {
          fail(sourceFile, spec, `step "${id}" must declare run as an inline function`);
          continue;
        }
        stepDecls.push({
          constName: decl.name.text,
          unit: factories.get(callee.text)!,
          id,
          inputKeys,
          runFn,
          sourceFile,
          specNode: spec,
        });
      }
    }
  };
  sourceFile.statements.forEach(visitTopLevel);
}

const stepConstNames = new Set(stepDecls.map((decl) => decl.constName));
const wiringConstNames = new Set(wiringUnits.keys());

// ---------------------------------------------------------------------------
// Pass 2 — verify each step's run body against its declared inputs.
// ---------------------------------------------------------------------------

for (const decl of stepDecls) {
  const { runFn, sourceFile, id, inputKeys } = decl;
  const firstParam = runFn.parameters[0];
  const boundNames = new Set<string>();

  if (firstParam && ts.isObjectBindingPattern(firstParam.name)) {
    const destructured: string[] = [];
    for (const element of firstParam.name.elements) {
      if (element.dotDotDotToken) {
        fail(sourceFile, element, `step "${id}": rest destructuring hides the dataflow — bind inputs by name`);
        continue;
      }
      const key = element.propertyName
        ? propName(element.propertyName)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null;
      if (key === null || !ts.isIdentifier(element.name)) {
        fail(sourceFile, element, `step "${id}": input bindings must be plain identifiers`);
        continue;
      }
      destructured.push(key);
      boundNames.add(element.name.text);
    }
    const declared = new Set(inputKeys);
    for (const key of destructured) {
      if (!declared.has(key)) {
        fail(sourceFile, firstParam, `step "${id}": run destructures "${key}" which is not a declared input`);
      }
    }
    for (const key of inputKeys) {
      if (!destructured.includes(key)) {
        fail(sourceFile, firstParam, `step "${id}": declared input "${key}" is never bound by run`);
      }
    }
  } else if (inputKeys.length > 0) {
    fail(
      sourceFile,
      firstParam ?? runFn,
      `step "${id}": run must destructure its ${inputKeys.length} declared input(s) so the dataflow is statically visible`,
    );
  }

  // No closure over other steps/wirings — cross-step dataflow must be a
  // declared input, otherwise the projected DAG lies about an edge.
  const body = runFn.body;
  if (body) {
    const walk = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isValueReference(node) && !boundNames.has(node.text)) {
        if (stepConstNames.has(node.text)) {
          fail(sourceFile, node, `step "${id}": run body references step constant "${node.text}" — declare it as an input instead`);
        } else if (wiringConstNames.has(node.text)) {
          fail(sourceFile, node, `step "${id}": run body references wiring "${node.text}" — consume its port via inputs instead`);
        }
      }
      node.forEachChild(walk);
    };
    walk(body);
  }
}

// ---------------------------------------------------------------------------
// Pass 3 — graphDef.ts: every node executes through runUnit(<its wiring>).
// ---------------------------------------------------------------------------

const graphSource = parse(GRAPH_DEF);
const units = new Set(wiringUnits.values());
const nodesSeen = new Map<string, string>(); // unit id -> wiring const used

const visitGraph = (node: ts.Node): void => {
  if (ts.isObjectLiteralExpression(node)) {
    const idProp = objectProp(node, "id");
    const runProp = objectProp(node, "run");
    const id =
      idProp && ts.isPropertyAssignment(idProp) && ts.isStringLiteral(idProp.initializer)
        ? idProp.initializer.text
        : null;
    if (id && units.has(id) && runProp) {
      const runFn = functionOfProp(runProp);
      if (!runFn || !runFn.body) {
        fail(graphSource, node, `node "${id}": run must be an inline function`);
      } else {
        const wiringRefs = new Set<string>();
        let runUnitCalls = 0;
        const walk = (child: ts.Node): void => {
          if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "runUnit") {
            runUnitCalls += 1;
            const arg = child.arguments[0];
            if (!arg || !ts.isIdentifier(arg) || !wiringUnits.has(arg.text)) {
              fail(graphSource, child, `node "${id}": runUnit's first argument must be a wiring constant`);
            }
          }
          if (ts.isIdentifier(child) && isValueReference(child) && wiringConstNames.has(child.text)) {
            wiringRefs.add(child.text);
          }
          child.forEachChild(walk);
        };
        walk(runFn.body);
        if (runUnitCalls !== 1) {
          fail(graphSource, node, `node "${id}": run must call runUnit exactly once (found ${runUnitCalls})`);
        }
        for (const ref of wiringRefs) {
          const refUnit = wiringUnits.get(ref);
          if (refUnit !== id) {
            fail(graphSource, node, `node "${id}": run references wiring "${ref}" of unit "${refUnit}" — a node may only execute its own wiring`);
          } else {
            nodesSeen.set(id, ref);
          }
        }
        if (!nodesSeen.has(id) && runUnitCalls === 1) {
          fail(graphSource, node, `node "${id}": run does not execute its own unit's wiring`);
        }
      }
    }
  }
  node.forEachChild(visitGraph);
};
visitGraph(graphSource);

for (const unit of units) {
  if (!nodesSeen.has(unit)) {
    errors.push(`graphDef.ts: no pipeline node executes wiring for unit "${unit}"`);
  }
}

// ---------------------------------------------------------------------------
// Pass 4 — runUnit is called ONLY from graphDef.ts (no side-channel execution).
// ---------------------------------------------------------------------------

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) yield full;
  }
}

for (const filePath of walkFiles(SRC_DIR)) {
  if (filePath === GRAPH_DEF || filePath === RUNNER_FILE) continue;
  const text = readFileSync(filePath, "utf8");
  if (!text.includes("runUnit(")) continue;
  const sourceFile = parse(filePath);
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "runUnit") {
      fail(sourceFile, node, "runUnit may only be called from graphDef.ts node bodies");
    }
    node.forEachChild(walk);
  };
  walk(sourceFile);
}

// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`check_step_dataflow: ${errors.length} violation(s)\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `check_step_dataflow: OK — ${stepDecls.length} steps across ${units.size} units; ` +
    "run-body dataflow matches declared inputs; every graphDef node executes exactly its own wiring.",
);
