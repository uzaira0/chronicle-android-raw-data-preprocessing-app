/**
 * Typed dependency graph — declarations only.
 *
 * The pipeline is declared as nodes connected by typed edges:
 *   feeds — upstream node output is this node's input (dataflow)
 *   gates — an option decides whether the node applies at all (on/off)
 *   tunes — an option parameterizes the node's transform
 *
 * Node ids use the community vocabulary documented in
 * docs/pipeline-graph/08-prior-art-vocabulary.md.
 */

import type { ExpectationResult, UnitExecutionRecord } from "@/lib/pipelineGraph/executionRecords";

export type Section = "preprocess" | "clean" | "analyze" | "output";

export type EdgeType = "feeds" | "gates" | "tunes";

export interface KnobBinding {
  /** camelCase BrowserProcessingOptions key */
  optionKey: string;
  edge: "gates" | "tunes";
}

export interface NodeDef<Ctx> {
  /** Stable node id (snake_case, community-grounded). */
  id: string;
  /** Human label shown in the graph view. */
  label: string;
  /**
   * Plain-English explanation of what the step does (and, where relevant,
   * why it sits where it sits) — shown as the node tooltip and under the
   * sentence bar when the node is selected. Community-grounded wording
   * (docs/pipeline-graph/08-prior-art-vocabulary.md), no jargon.
   */
  description?: string;
  section: Section;
  /** Upstream node ids — the `feeds` edges. */
  inputs: string[];
  /** Options bound to this node — the `gates`/`tunes` edges. */
  knobs: KnobBinding[];
  /** BrowserSupportFiles keys whose content this node depends on. */
  supportFiles?: string[];
  /**
   * Node body. Receives the shared run context and a map of upstream
   * outputs keyed by node id. Must be deterministic given (ctx-bound
   * options, support files, inputs). May return a value or a promise —
   * the engine awaits either.
   */
  run: (ctx: Ctx, inputs: Record<string, unknown>) => unknown;
  /**
   * True when the current options turn this whole step off (its body is a
   * pass-through / empty-return). The body STILL RUNS — downstream nodes
   * need the pass-through value — but the run is reported as "bypassed"
   * instead of "recomputed"/"cached", and the graph view can mark the node
   * off without running anything. Omit for nodes that always do work
   * (partial gates that only skip part of the body do not count as off).
   */
  bypassedWhen?: (options: Record<string, unknown>) => boolean;
  /**
   * Early cutoff (Salsa backdating). When true and a recompute yields a
   * value deep-equal to the cached one, the node keeps its previous stamp
   * so downstream nodes stay cached. Equality is checked against the
   * cached value the engine already holds (`valuesEqual`): a first run
   * pays nothing, and a changed rerun exits at the first difference —
   * unlike the output-hashing this replaced, which serialized the full
   * output on EVERY recompute (measured 44% of pipeline wall time on
   * 123k-row files). When omitted, any recompute marks downstream dirty.
   */
  earlyCutoff?: boolean;
  /**
   * Optional unit-level runtime expectations, evaluated by the engine
   * after a live run over (output, inputs). Results are REPORT data
   * (severity "warn", recorded on the node's UnitExecutionRecord) — a
   * violated expectation never throws or changes behavior.
   */
  expectations?: (
    output: unknown,
    inputs: Record<string, unknown>,
  ) => ExpectationResult[];
}

export interface GraphDef<Ctx> {
  nodes: NodeDef<Ctx>[];
}

export type NodeStatus = "cached" | "recomputed" | "error" | "skipped" | "bypassed";

export interface RunReport {
  /** Status per node id after a run. */
  statuses: Record<string, NodeStatus>;
  /** Error message per node id for nodes with status "error". */
  errors: Record<string, string>;
  /**
   * Per-node execution records (timing, row counts, expectations), in run
   * order — the engine half of the ExecutionLedger.
   */
  executions: UnitExecutionRecord[];
}

export interface RunKeys {
  /** Current option values (only bound keys participate in cache keys). */
  options: Record<string, unknown>;
  /** Content hashes of loaded support files, keyed by support-file key. */
  supportFileHashes: Record<string, string>;
  /** Hash of the raw input (file content); feeds source nodes. */
  inputHash: string;
}

export interface RunResult {
  outputs: Map<string, unknown>;
  report: RunReport;
}
