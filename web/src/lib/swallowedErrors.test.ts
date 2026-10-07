import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * An error the app swallows must say why swallowing it is correct. This walks
 * every production source file and finds the two shapes that discard an error
 * outright, an empty `catch {}` block and a `.catch(() => {})` handler that
 * does nothing, and requires each to carry a comment giving the reason (three
 * words or more, so `/* ignore *\/` does not count). A swallow that is not
 * correct is handled instead: shown, recorded with `recordError`, or retried.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["wasm", "generated", "testSupport"].includes(entry.name) && directory === SRC ? [] : productionSources(path);
    }
    return /\.(ts|tsx|js)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

function commentGivesReason(text: string): boolean {
  const comments = text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? [];
  return comments.some((comment) =>
    (comment.replace(/^\/\/|^\/\*|\*\/$/g, "").match(/[A-Za-z]{2,}/g) ?? []).length >= 3);
}

function doesNothing(handler: ts.Expression): boolean {
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  const body = handler.body;
  if (ts.isBlock(body)) return body.statements.length === 0;
  return body.kind === ts.SyntaxKind.NullKeyword
    || body.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isIdentifier(body) && body.text === "undefined")
    || ts.isVoidExpression(body);
}

type Swallow = { at: string; reasoned: boolean };

function swallows(file: string): Swallow[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const found: Swallow[] = [];
  const at = (node: ts.Node) =>
    `${relative(SRC, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      found.push({ at: at(node), reasoned: commentGivesReason(node.block.getText()) });
    }
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "catch"
      && node.arguments.length === 1
      && doesNothing(node.arguments[0]!)) {
      const line = source.getLineAndCharacterOfPosition(node.expression.name.getStart()).line;
      // The reason sits in the handler or on the lines just above `.catch`.
      const nearby = lines.slice(Math.max(0, line - 4), line + 1).join("\n");
      found.push({
        at: at(node.expression.name),
        reasoned: commentGivesReason(node.arguments[0]!.getText()) || commentGivesReason(nearby),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("swallowed errors", () => {
  const all = productionSources(SRC).flatMap(swallows);

  it("finds the swallows that exist", () => {
    // An empty result would pass the next assertion vacuously.
    expect(all.length).toBeGreaterThan(30);
    expect(all.some(({ at }) => at.startsWith("lib/rustWorkerClient.ts"))).toBe(true);
  });

  it("gives every swallowed error a reason", () => {
    expect(all.filter(({ reasoned }) => !reasoned).map(({ at }) => at)).toEqual([]);
  });
});
