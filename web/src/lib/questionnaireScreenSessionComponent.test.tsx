import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LiteratureComponentResultPanel } from "@/components/LiteratureComponentResultPanel";
import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureComponentExecutionForSettings,
} from "@/lib/literatureInputAdapters";
import type { LiteratureComponentRuntimeExecution } from "@/lib/rustPipelineRuntime";

describe("questionnaire screen-session literature component", () => {
  it("requires all fifteen exact settings and renders receipt limitations", () => {
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find(
      ({ semanticType }) =>
        semanticType === "questionnaire_screen_session_summary",
    );
    expect(group).toBeDefined();
    expect(group!.methodSettingIds).toHaveLength(15);

    const registration = literatureComponentExecutionForSettings(
      group!.methodSettingIds,
    );
    expect(registration).toMatchObject({
      componentId: "chronicle.questionnaire-screen-session-summary/v1",
      parentMethodProfileId:
        "method-profile:doi:10.1016/j.chb.2023.107977",
      sourceWorkId: "doi:10.1016/j.chb.2023.107977",
      fullProfileExecutionStatus: "blocked",
      requiredSupportRoles: [],
    });
    expect(
      literatureComponentExecutionForSettings(
        group!.methodSettingIds.slice(0, -1),
      ),
    ).toBeUndefined();

    const result = {
      manifest: {
        componentId: registration!.componentId,
        sourceRowCount: 9,
        derivedResultRowCount: 1,
      },
      componentExecutionReceipt: {
        limitations: registration!.limitations,
      },
      artifacts: [
        {
          metadata: {
            kind: registration!.derivedResultKind,
            mediaType: "text/csv",
            size: 512,
            rowCount: 1,
          },
          bytes: new Uint8Array(),
        },
      ],
    } as unknown as LiteratureComponentRuntimeExecution;
    const html = renderToStaticMarkup(
      createElement(LiteratureComponentResultPanel, {
        result,
        error: null,
        onDelete: vi.fn(),
        onError: vi.fn(),
      }),
    );

    expect(html).toContain(registration!.componentId);
    expect(html).toContain("9 source rows");
    expect(html).toContain("1 derived rows");
    expect(html).toContain(registration!.derivedResultKind);
    expect(html).toContain("caller-supplied questionnaire membership");
    expect(html).toContain("broken-screen-logging exclusion");
  });
});
