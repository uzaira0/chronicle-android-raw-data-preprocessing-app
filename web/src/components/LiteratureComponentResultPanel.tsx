import type { ReactElement } from "react";

import { downloadBlob } from "@/lib/download";
import {
  readPersistedRustArtifact,
  type LiteratureComponentArtifactResult,
  type LiteratureComponentRuntimeExecution,
} from "@/lib/rustPipelineRuntime";

type Props = {
  result: LiteratureComponentRuntimeExecution | null;
  error: string | null;
  onDelete: () => void;
  onError: (message: string) => void;
};

function outputName(artifact: LiteratureComponentArtifactResult): string {
  const extension = artifact.metadata.mediaType === "text/csv" ? "csv"
    : artifact.metadata.mediaType === "application/vnd.apache.arrow.file" ? "arrow" : "json";
  return `${artifact.metadata.kind}.${extension}`;
}

async function artifactBytes(
  artifact: LiteratureComponentArtifactResult,
): Promise<Uint8Array> {
  if (artifact.bytes) return artifact.bytes;
  if (!artifact.persistedArtifact) {
    throw new Error(
      `Artifact bytes are unavailable: ${artifact.metadata.kind}`,
    );
  }
  return readPersistedRustArtifact(
    artifact.persistedArtifact.workspaceId,
    artifact.persistedArtifact.kind,
    artifact.persistedArtifact.workspaceRootDigest,
  );
}

export function LiteratureComponentResultPanel({
  result,
  error,
  onDelete,
  onError,
}: Props): ReactElement | null {
  if (!result && !error) return null;
  return (
    <section
      className="result-panel"
      aria-labelledby="literature-component-results-title"
    >
      <div className="workflow-section__header">
        <div>
          <h3
            id="literature-component-results-title"
            className="workflow-section__subtitle"
          >
            Literature component result
          </h3>
          {result ? (
            <p className="workflow-section__intro">
              Executed {result.manifest.componentId}:{" "}
              {result.manifest.sourceRowCount.toLocaleString()} source rows →{" "}
              {result.manifest.derivedResultRowCount.toLocaleString()} derived
              rows. The parent paper profile remains blocked.
            </p>
          ) : null}
        </div>
        {result ? (
          <button type="button" className="btn btn--ghost" onClick={onDelete}>
            Delete component result
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {result?.componentExecutionReceipt.limitations.length ? (
        <div
          className="status-banner"
          role="note"
          aria-label="Execution limitations"
        >
          <p className="u-meta-xs">Execution limitations</p>
          <ul className="preset-diff__list">
            {result.componentExecutionReceipt.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result ? (
        <ul className="preset-diff__list">
          {result.artifacts.map((artifact) => (
            <li key={artifact.metadata.kind}>
              <span className="preset-diff__label">
                {artifact.metadata.kind}
              </span>
              <span className="text-faint u-meta-xs">
                {artifact.metadata.size.toLocaleString()} bytes
                {artifact.metadata.rowCount === undefined ||
                artifact.metadata.rowCount === null
                  ? ""
                  : ` · ${artifact.metadata.rowCount.toLocaleString()} rows`}
              </span>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  void artifactBytes(artifact)
                    .then((bytes) =>
                      downloadBlob(
                        outputName(artifact),
                        new Blob([bytes as Uint8Array<ArrayBuffer>], {
                          type: artifact.metadata.mediaType,
                        }),
                      ),
                    )
                    .catch((downloadError: unknown) =>
                      onError(
                        downloadError instanceof Error
                          ? downloadError.message
                          : String(downloadError),
                      ),
                    );
                }}
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
