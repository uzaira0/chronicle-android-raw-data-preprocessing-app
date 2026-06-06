import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { CheckboxGroup } from "@/components/CheckboxGroup";
import { InteractionRemapEditor } from "@/components/InteractionRemapEditor";
import {
  DEFAULT_BROWSER_OPTIONS,
  INTERACTION_TYPES_TO_REMOVE_OPTIONS,
  OTHER_INTERACTION_TYPE_OPTIONS,
  SAME_APP_INTERACTION_TYPE_OPTIONS,
} from "@/lib/browserPipeline";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "sameAppInteractionTypesToStopUsageAt",
  "otherInteractionTypesToStopUsageAt",
  "interactionTypesToRemove",
  "interactionTypeRemap",
];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function InteractionSemanticsCard({ options, setOptions }: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);

  return (
    <SectionCard
      id="interaction-semantics"
      title="Interaction semantics"
      accent="interaction"
      defaultExpanded={false}
      modified={anyOptionModified(options, KEYS)}
    >
      <p className="u-card-intro">
        Pick which Android usage event interaction types end a session, and which to drop from
        the final output. The defaults match the canonical desktop preprocessing semantics.
      </p>
      <CheckboxGroup
        title="Same app interaction types that end a session"
        options={[...SAME_APP_INTERACTION_TYPE_OPTIONS]}
        selected={options.sameAppInteractionTypesToStopUsageAt}
        onChange={(next) => update("sameAppInteractionTypesToStopUsageAt", next)}
        tooltip={TOOLTIPS.sameAppInteractionTypesToStopUsageAt}
        modified={isMod("sameAppInteractionTypesToStopUsageAt")}
        onReset={() => reset("sameAppInteractionTypesToStopUsageAt")}
      />
      <CheckboxGroup
        title="Other interaction types that end a session"
        options={[...OTHER_INTERACTION_TYPE_OPTIONS]}
        selected={options.otherInteractionTypesToStopUsageAt}
        onChange={(next) => update("otherInteractionTypesToStopUsageAt", next)}
        tooltip={TOOLTIPS.otherInteractionTypesToStopUsageAt}
        modified={isMod("otherInteractionTypesToStopUsageAt")}
        onReset={() => reset("otherInteractionTypesToStopUsageAt")}
      />
      <CheckboxGroup
        title="Interaction types to remove from final output"
        options={INTERACTION_TYPES_TO_REMOVE_OPTIONS.map((value) => ({ label: value, value }))}
        selected={options.interactionTypesToRemove}
        onChange={(next) => update("interactionTypesToRemove", next)}
        tooltip={TOOLTIPS.interactionTypesToRemove}
        modified={isMod("interactionTypesToRemove")}
        onReset={() => reset("interactionTypesToRemove")}
        searchable
      />
      <InteractionRemapEditor
        value={options.interactionTypeRemap}
        onChange={(next) => update("interactionTypeRemap", next)}
        tooltip={TOOLTIPS.interactionTypeRemap}
        modified={isMod("interactionTypeRemap")}
        onReset={() => reset("interactionTypeRemap")}
      />
    </SectionCard>
  );
}
