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
   * options, support files, inputs).
   */
  run: (ctx: Ctx, inputs: Record<string, unknown>) => Promise<unknown> | unknown;
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
   * Optional content hash of the node's output. When provided and the
   * recomputed hash matches the previous one, downstream nodes stay
   * cached (early cutoff). When omitted, any recompute marks downstream
   * dirty.
   */
  outputHash?: (value: unknown) => string;
}

export interface GraphDef<Ctx> {
  nodes: NodeDef<Ctx>[];
}

export type NodeStatus = "cached" | "recomputed" | "dirty" | "error" | "skipped" | "bypassed";

export interface RunReport {
  /** Status per node id after a run. */
  statuses: Record<string, NodeStatus>;
  /** Error message per node id for nodes with status "error". */
  errors: Record<string, string>;
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
