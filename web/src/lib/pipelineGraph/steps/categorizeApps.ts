import {
  applyBroadCategoryDerivation,
  collapseGenreIds,
  joinCodebookColumns,
  type CanonicalRow,
} from "@/lib/browserPipeline";
import { reconstructEpisodesWiring } from "@/lib/pipelineGraph/steps/reconstructEpisodes";
import { port, stepsOf, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("categorize_apps");

export const codebookJoin = step({
  id: "codebook_join",
  label: "Codebook join",
  description:
    "Join each episode's package against the app codebook: null-fill output columns, copy matched records through the rename map, stamp Unknown sentinels.",
  inputs: { rows: reconstructEpisodesWiring.wholePort },
  run: ({ rows }, ctx) => joinCodebookColumns(rows, ctx.options, ctx.support.codebookMap),
});

export const deriveBroadCategory = step({
  id: "derive_broad_category",
  label: "Derive broad category",
  description:
    "Coalesce the per-source category columns onto the palette vocabulary (desktop order) for every row with a codebook record.",
  inputs: { join: codebookJoin },
  run: ({ join }) => applyBroadCategoryDerivation(join),
});

export const collapseGenre = step({
  id: "collapse_genre",
  label: "Collapse genre ids",
  description:
    "Reconcile per-source genre ids: agreement promotes the genre, disagreement yields null, none yields Unknown.",
  inputs: { join: deriveBroadCategory },
  run: ({ join }) => collapseGenreIds(join),
});

export const categorizeAppsWiring = wireUnitWhole<CanonicalRow[]>(
  "categorize_apps",
  [codebookJoin, deriveBroadCategory, collapseGenre],
  port(collapseGenre),
);
