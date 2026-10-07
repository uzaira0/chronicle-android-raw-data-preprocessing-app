import {
  buildArtifactFixtureState,
  type ArtifactFixtureState,
} from "@/testSupport/artifactInterventions";
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";

export const B06_ALL_OUTPUTS_INTERSECTION_PROFILE_ID =
  "support-intersections" as const;

export const B06_ALL_OUTPUTS_INTERSECTION_FILES = {
  raw_chronicle_csv: "b06-all-outputs-intersection.csv",
  app_codebook_file: "b06-all-outputs-intersection-app-codebook.csv",
  apps_forcing_screen_open_file:
    "b06-all-outputs-intersection-apps-forcing-screen-open.csv",
  background_apps_file: "b06-all-outputs-intersection-background-apps.csv",
  device_sharing_file: "b06-all-outputs-intersection-device-sharing.csv",
  enrolled_devices_file: "b06-all-outputs-intersection-enrolled-devices.csv",
  filter_file: "b06-all-outputs-intersection-apps-to-filter.csv",
  study_dates_file: "b06-all-outputs-intersection-study-dates.csv",
  survey_attribution_file:
    "b06-all-outputs-intersection-survey-attribution.csv",
} as const;

export type B06AllOutputsIntersectionRole =
  keyof typeof B06_ALL_OUTPUTS_INTERSECTION_FILES;

export type B06AllOutputsIntersectionFixture = {
  role: B06AllOutputsIntersectionRole;
  fileName: (typeof B06_ALL_OUTPUTS_INTERSECTION_FILES)[B06AllOutputsIntersectionRole];
  csv: string;
};

type DefaultCatalogCsvs = {
  codebookCsv: string;
  filterCsv: string;
  backgroundCsv: string;
  forcingScreenOpenCsv: string;
};

const ACTIVE_SUPPORT_ROLES = [
  "app_codebook_file",
  "apps_forcing_screen_open_file",
  "background_apps_file",
  "device_sharing_file",
  "enrolled_devices_file",
  "filter_file",
  "study_dates_file",
  "survey_attribution_file",
] as const satisfies ReadonlyArray<
  Exclude<B06AllOutputsIntersectionRole, "raw_chronicle_csv">
>;

/**
 * Deterministically materialize the synthetic C20 raw input and its eight
 * active CSV supports. Capability evidence is intentionally excluded: the
 * fused/Chronicle C20 binding does not activate that role, and admitting it
 * would make the archive/input census claim a source that execution ignores.
 */
export function buildB06AllOutputsIntersectionFixtures(
  defaults: DefaultCatalogCsvs,
): B06AllOutputsIntersectionFixture[] {
  const profile = SYNTHETIC_CORPUS_PROFILES.find(
    ({ id }) => id === B06_ALL_OUTPUTS_INTERSECTION_PROFILE_ID,
  );
  if (!profile) {
    throw new Error("missing support-intersections synthetic corpus profile");
  }
  const sourceCatalog = buildSyntheticCatalog(defaults);
  // The shared campaign catalog preserves its historical locale collation.
  // This frozen proof fixture must instead be independent of host ICU data,
  // so normalize the only order-sensitive catalog vector by UTF-16 code unit.
  const catalog = {
    ...sourceCatalog,
    apps: [...sourceCatalog.apps].sort((left, right) =>
      left.packageName < right.packageName
        ? -1
        : left.packageName > right.packageName
          ? 1
          : 0,
    ),
  };
  const corpus = generateSyntheticChronicleCorpus(profile, catalog);
  if (corpus.rowCount !== 193) {
    throw new Error(
      `support-intersections row-count drift: expected 193, observed ${corpus.rowCount}`,
    );
  }
  const state: ArtifactFixtureState = buildArtifactFixtureState({
    corpus,
    catalog,
    filterCsv: defaults.filterCsv,
    forcingCsv: defaults.forcingScreenOpenCsv,
    backgroundCsv: defaults.backgroundCsv,
  });
  return [
    {
      role: "raw_chronicle_csv",
      fileName: B06_ALL_OUTPUTS_INTERSECTION_FILES.raw_chronicle_csv,
      csv: state.rawCsv,
    },
    ...ACTIVE_SUPPORT_ROLES.map((role) => ({
      role,
      fileName: B06_ALL_OUTPUTS_INTERSECTION_FILES[role],
      csv: state.supports[role].csv,
    })),
  ];
}
