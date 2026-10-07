import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson } from "@/testSupport/privateCorpus";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile } from "./methodProfiles";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { atteliaObservationExample } from "../../e2e/fixtures/temporal-observations";
const canonical=lazyPrivateCorpusJson<{profiles:StudyMethodProfile[]}>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
function input(){
  const profile=structuredClone(canonical().profiles.find(p=>p.source_work_id==="doi:10.1145/2750858.2807517")!);
  return {profiles:[profile],...atteliaObservationExample(profile)};
}
const setting=(v:ReturnType<typeof input>,key:string)=>v.profiles[0]!.method_settings.find(s=>s.method_parameter_key===key)!;
const record=(v:ReturnType<typeof input>,id:string)=>v.sampled_quantity_observations.find(r=>r.sampled_observation_id==="constructed:attelia-"+id)!;
itWithPrivateCorpus.each([
  ["shared-watch_activity", "detector type", '"invented detector"', /disclosed Attelia detector\/model\/device state/],
  ["shared-watch_activity", "breakpoint", "false", /supplied breakpoint state, not an inferred trigger/],
  ["gain-g", "mean ESM score", "0", /supplied ESM mean domain/],
  ["gain-g", "gain", "true", /independent supplied scalar or unknown/],
] as const)("rejects Attelia supplied %s %s domain contradictions", (id, property, token, error) => {
  const value = input(); record(value, id).quantities!.find(q => q.observed_property === property)!.evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(value)).toThrow(error);
});
const sampleKeys=["acquisition.interdevice_breakpoint_sharing","feature.device_use_screen_proxy","feature.combination_freshness","feature.combination_trigger","model.base_state_conditional_delivery","model.combo_conjunction","model.combo_x_disjunction","intervention.delivery_device","validation.phase1_joint_comparison","analysis.phase1_gain_selection","validation.phase2_daily_assignment"];
itWithPrivateCorpus("preserves Attelia cross-device evidence, recipient-owned artificial ESMs and one shared phase1 prompt through import/IndexedDB/reopen",async()=>{
  const v=input(),parsed=parseStudyMethodProfileLibrary(v);
  // The audit has 50 atoms: its two-phase campaign atom projects to configuration metadata, not a setting.
  expect(v.profiles[0]!.method_settings).toHaveLength(49);expect(parsed.profiles).toEqual(v.profiles);
  expect(parsed.sampled_quantity_observations).toEqual(v.sampled_quantity_observations);expect(parsed.task_occurrences).toEqual(v.task_occurrences);
  const comparisons=v.sampled_quantity_observations.filter(r=>r.method_setting_reference===setting(v,"validation.phase1_joint_comparison").method_setting_id);
  expect(comparisons).toHaveLength(9);expect(new Set(comparisons.map(r=>r.task_occurrence_reference)).size).toBe(1);
  const phone=record(v,"delivery-phone"),watch=record(v,"delivery-watch");
  expect(phone.device_id).not.toBe(watch.device_id);
  expect(record(v,"shared-watch_activity").device_id).not.toBe(record(v,"current-watch_activity").device_id);
  expect(v.task_occurrences).toHaveLength(4);
  const selected={profile:parsed.profiles[0]!,selectedLevels:{},sampled_quantity_observations:parsed.sampled_quantity_observations!,task_occurrences:parsed.task_occurrences!};
  await saveResearchMethodSelection(JSON.stringify(selected));
  const saved=JSON.parse((await loadResearchMethodSelection())!) as typeof selected;expect(saved).toEqual(selected);
  expect(parseStudyMethodProfileLibrary({profiles:[saved.profile],sampled_quantity_observations:saved.sampled_quantity_observations,task_occurrences:saved.task_occurrences}).sampled_quantity_observations).toEqual(v.sampled_quantity_observations);
});
for(const kind of ["sample","response","criterion"] as const)for(const key of kind==="sample"?sampleKeys:kind==="response"?["diary.esm_interruptibility_response","diary.nightly_nasa_tlx"]:["diary.nightly_nasa_tlx"]){
  itWithPrivateCorpus("requires exact Attelia "+kind+" source/definition independently for "+key,()=>{
    const isolate=(v:ReturnType<typeof input>)=>{
      if(kind==="sample"){v.task_occurrences=[];v.sampled_quantity_observations=v.sampled_quantity_observations.filter(r=>r.method_setting_reference===setting(v,key).method_setting_id);for(const row of v.sampled_quantity_observations){delete row.sampled_observation_references;delete row.task_occurrence_reference;}}
      else{v.sampled_quantity_observations=[];v.task_occurrences=v.task_occurrences.filter(t=>(kind==="response"?t.task_questionnaire_responses:t.criterion_assessments)?.some(r=>(kind==="response"?r.questionnaire_setting_reference:r.criterion_setting_reference)===setting(v,key).method_setting_id));
        for(const task of v.task_occurrences){if(kind==="response"){task.criterion_assessments=[];task.task_questionnaire_responses=task.task_questionnaire_responses!.filter(r=>r.questionnaire_setting_reference===setting(v,key).method_setting_id);}else{task.task_questionnaire_responses=[];}}
      }return v;
    };
    const good=isolate(input());expect(()=>parseStudyMethodProfileLibrary(good)).not.toThrow();
    if (kind !== "sample") {
      const bad = structuredClone(good);
      const child = kind === "response" ? bad.task_occurrences[0]!.task_questionnaire_responses![0]! : bad.task_occurrences[0]!.criterion_assessments![0]!;
      Reflect.set(child, kind === "response" ? "observed_property" : "criterion_label", "invented workload meaning");
      expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("disclosed Attelia ESM/workload meaning");
    }
    const local=setting(good,key),raw:unknown=JSON.parse(String(local.method_value_json));
    const body=raw!==null&&typeof raw==="object"&&!Array.isArray(raw)&&Object.hasOwn(raw,"definition")?(raw as {definition:unknown}).definition:raw;
    const wrapper={definition:body,source_facing_role:local.method_setting_role,source_facing_target:local.method_target_layer};
    const wrapped=isolate(input());setting(wrapped,key).method_value_json=JSON.stringify(wrapper);expect(()=>parseStudyMethodProfileLibrary(wrapped)).not.toThrow();
    for(const corruption of [null,"decoy",{},[body],{definition:body},{...wrapper,definition:null},{...wrapper,definition:false},{...wrapper,source_facing_role:null},{...wrapper,source_facing_target:"foreign"}]){
      const bad=isolate(input());setting(bad,key).method_value_json=JSON.stringify(corruption);expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow();
    }
    const wrong=isolate(input());setting(wrong,key).method_setting_role="provenance";expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();
  });
}
itWithPrivateCorpus("keeps same-person cross-device lookup local and rejects foreign/ambiguous/self/unknown/duplicate supplied references",()=>{
  const valid=input();const copy=structuredClone(record(valid,"shared-watch_activity"));copy.participant_id="constructed:other-person";valid.sampled_quantity_observations.push(copy);
  expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(valid.sampled_quantity_observations);
  for(const ref of ["unknown","constructed:attelia-current-watch_activity"]){const v=input();record(v,"current-watch_activity").sampled_observation_references![0]!.sampled_observation_reference=ref;expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/compatible, distinct/);}
  const foreign=input();record(foreign,"shared-watch_activity").participant_id="constructed:other-person";expect(()=>parseStudyMethodProfileLibrary(foreign)).toThrow(/compatible, distinct/);
  const ambiguous=input(),second=structuredClone(record(ambiguous,"shared-watch_activity"));second.device_id="constructed:second-watch";ambiguous.sampled_quantity_observations.push(second);
  expect(()=>parseStudyMethodProfileLibrary(ambiguous)).toThrow(/unambiguously/);
  const duplicate=input();record(duplicate,"current-watch_activity").sampled_observation_references!.push({...record(duplicate,"current-watch_activity").sampled_observation_references![0]!});expect(()=>parseStudyMethodProfileLibrary(duplicate)).toThrow(/duplicates/);
  const wrongType=input();record(wrongType,"shared-watch_activity").quantities![0]!.evidence_value_json='"phone_activity"';expect(()=>parseStudyMethodProfileLibrary(wrongType)).toThrow(/shared detector type/);
});
itWithPrivateCorpus("validates only explicitly associated recipient/state contradictions and preserves unknown proxy/supports",()=>{
  const wrongUsageType = input(); record(wrongUsageType, "phone-on").quantities!.find(q => q.observed_property === "device type")!.evidence_value_json = '"watch"';
  expect(() => parseStudyMethodProfileLibrary(wrongUsageType)).toThrow(/explicitly associated usage-device type/);
  for(const [id,destination] of [["delivery-phone","watch"],["delivery-watch","phone"]] as const){const v=input();record(v,id).quantities![0]!.evidence_value_json=JSON.stringify(destination);expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/phone-use proxy/);}
  const identity=input();record(identity,"phone-on").device_id="constructed:wrong-known-phone";expect(()=>parseStudyMethodProfileLibrary(identity)).toThrow(/recipient device/);
  const wrongTask=input();record(wrongTask,"delivery-phone").task_occurrence_reference="constructed:attelia-esm-watch";expect(()=>parseStudyMethodProfileLibrary(wrongTask)).toThrow(/task within profile/);
  const wrongWorkload=input();record(wrongWorkload,"delivery-phone").task_occurrence_reference="constructed:attelia-nightly";wrongWorkload.task_occurrences[3]!.device_id=record(wrongWorkload,"delivery-phone").device_id;
  expect(()=>parseStudyMethodProfileLibrary(wrongWorkload)).toThrow(/nightly workload/);
  for(const raw of [undefined,null,"null"] as const){const v=input(),q=record(v,"phone-on").quantities![1]!;if(raw===undefined)delete q.evidence_value_json;else q.evidence_value_json=raw;delete record(v,"phone-on").device_id;record(v,"delivery-phone").quantities![0]!.evidence_value_json='"watch"';record(v,"delivery-phone").sampled_observation_references=record(v,"delivery-phone").sampled_observation_references!.filter(link=>link.relationship_label!=="watch usage state");expect(()=>parseStudyMethodProfileLibrary(v)).not.toThrow();}
  for(const refs of [undefined,null,[]] as const){const v=input();for(const row of v.sampled_quantity_observations){if(refs===undefined)delete row.sampled_observation_references;else if(row.sampled_observation_references!==undefined)row.sampled_observation_references=refs===null?null:[];}expect(parseStudyMethodProfileLibrary(v).sampled_quantity_observations).toEqual(v.sampled_quantity_observations);}
});
itWithPrivateCorpus("distinguishes observed all-four states from known included model members without calculating AND/OR outputs",()=>{
  const observed=input();record(observed,"phase1-0").sampled_observation_references!.push({...record(observed,"phase1-0").sampled_observation_references![3]!,relationship_label:"observed detector state",sampled_observation_reference:null});
  expect(()=>parseStudyMethodProfileLibrary(observed)).not.toThrow();
  const excluded=input();record(excluded,"phase1-0").sampled_observation_references![3]!.relationship_label="included detector state";
  expect(()=>parseStudyMethodProfileLibrary(excluded)).toThrow(/excluded detector/);
  const excludedCombo=input();record(excludedCombo,"combo-g").quantities![0]!.evidence_value_json='"Combo(c)"';expect(()=>parseStudyMethodProfileLibrary(excludedCombo)).toThrow(/excluded detector/);
  const excludedX=input();record(excludedX,"combo-g").quantities![0]!.evidence_value_json='"Combo(e)"';record(excludedX,"combo-g").sampled_observation_references=[];expect(()=>parseStudyMethodProfileLibrary(excludedX)).toThrow(/outside Combo/);
  const mismatch=input();record(mismatch,"assignment").quantities![1]!.evidence_value_json='"Phone UI"';expect(()=>parseStudyMethodProfileLibrary(mismatch)).toThrow(/associated selected model/);
  const independent=input();record(independent,"combo-g").quantities![1]!.evidence_value_json="false";record(independent,"combo-x").quantities![1]!.evidence_value_json="false";expect(()=>parseStudyMethodProfileLibrary(independent)).not.toThrow();
});
itWithPrivateCorpus("retains detector timestamps, 10-second definition, negative gain and missing/empty values without fabricated intervals or answers",()=>{
  const v=input();expect(v.sampled_quantity_observations.filter(r=>r.method_setting_reference===setting(v,"acquisition.interdevice_breakpoint_sharing").method_setting_id).every(r=>typeof r.source_event_time_token==="string"&&!Object.hasOwn(r,"observation_instant"))).toBe(true);
  const definition=JSON.parse(String(setting(v,"feature.combination_freshness").method_value_json)) as {definition:{lookback_seconds:number;equality:string}};
  expect(definition.definition).toMatchObject({lookback_seconds:10,equality:"not operationally specified"});
  expect(record(v,"gain-c").quantities!.find(q=>q.observed_property==="gain")!.evidence_value_json).toBe("-0.50");
  const equal=structuredClone(record(v,"shared-phone_ui"));equal.sampled_observation_id+=":equal";v.sampled_quantity_observations.push(equal);expect(parseStudyMethodProfileLibrary(v).sampled_quantity_observations).toEqual(v.sampled_quantity_observations);
  for(const field of ["sampled_observation_references","task_occurrence_reference","denotes_interval"]){const bad=input();Reflect.set(record(bad,"shared-phone_ui"),field,null);expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow();}
  for(const raw of [undefined,null,"null",'"opaque source code"'] as const){const good=input(),response=good.task_occurrences[0]!.task_questionnaire_responses![0]!;if(raw===undefined)delete response.response_value_json;else response.response_value_json=raw;expect(parseStudyMethodProfileLibrary(good).task_occurrences).toEqual(good.task_occurrences);}
  const unanswered=input();unanswered.task_occurrences[0]!.task_questionnaire_responses=[];expect(()=>parseStudyMethodProfileLibrary(unanswered)).not.toThrow();
  for(const value of [0,6,1.5,true,[3],{x:3}]){const bad=input();bad.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json=JSON.stringify(value);expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow();}
});
itWithPrivateCorpus("does not transplant qualified Attelia bodies into foreign profiles or borrow malformed companion definitions",()=>{
  for(const key of ["model.detector_configuration_inventory","feature.combination_freshness","intervention.phase1_sampling_quota"]){const bad=input();setting(bad,key).method_value_json=JSON.stringify({...JSON.parse(String(setting(bad,key).method_value_json)) as Record<string,unknown>,definition:null,source_interpretation_limits:"decoy outer content",source_facing_target:"foreign"});expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow();}
  const foreign=input();foreign.profiles[0]!.source_work_id="doi:10.1145/2750858.2804252";for(const s of foreign.profiles[0]!.method_settings)s.source_work_id=foreign.profiles[0]!.source_work_id;
  for(const row of [...foreign.task_occurrences,...foreign.sampled_quantity_observations])row.source_work_id=foreign.profiles[0]!.source_work_id;expect(()=>parseStudyMethodProfileLibrary(foreign)).toThrow();
});
itWithPrivateCorpus("binds accepted bare root bodies to their real source and preserves unknown identity/model without ignoring other known conflicts",()=>{
  const bare=input(),key="acquisition.interdevice_breakpoint_sharing",local=setting(bare,key);
  const content=JSON.parse(String(local.method_value_json)) as {definition:unknown};
  local.method_value_json=JSON.stringify(content.definition);expect(()=>parseStudyMethodProfileLibrary(bare)).not.toThrow();
  const foreign=structuredClone(bare);setting(foreign,key).source_work_id="doi:10.1145/2750858.2804252";expect(()=>parseStudyMethodProfileLibrary(foreign)).toThrow();
  const wrongRecipient=input(),delivery=record(wrongRecipient,"delivery-watch");
  delivery.sampled_observation_references=delivery.sampled_observation_references!.filter(link=>link.relationship_label!=="watch usage state");
  delivery.device_id=record(wrongRecipient,"phone-off").device_id;
  delivery.task_occurrence_reference=wrongRecipient.task_occurrences[0]!.task_occurrence_id;
  expect(()=>parseStudyMethodProfileLibrary(wrongRecipient)).toThrow(/opposite-device identity/);
  const modelConflict=input(),assignment=structuredClone(record(modelConflict,"assignment"));assignment.sampled_observation_id+=":other";
  assignment.quantities!.find(q=>q.observed_property==="model")!.evidence_value_json='"Phone UI"';modelConflict.sampled_quantity_observations.push(assignment);
  const d=record(modelConflict,"delivery-phone");d.quantities=d.quantities!.filter(q=>q.observed_property!=="model");
  d.sampled_observation_references!.find(link=>link.relationship_label==="daily model assignment")!.sampled_observation_reference=assignment.sampled_observation_id;
  expect(()=>parseStudyMethodProfileLibrary(modelConflict)).toThrow(/associated selected model/);
  const unknown=input();record(unknown,"delivery-watch").quantities=record(unknown,"delivery-watch").quantities!.filter(q=>q.observed_property!=="model");
  for(const id of ["phone-off","watch-off"])delete record(unknown,id).device_id;
  expect(parseStudyMethodProfileLibrary(unknown).sampled_quantity_observations).toEqual(unknown.sampled_quantity_observations);
});

itWithPrivateCorpus("preserves Attelia supplied relationships in existing generated JSON Schema/Pydantic records",()=>{
  const schema=resolve(import.meta.dirname,"../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),model=resolve(import.meta.dirname,"../../schema/generated/pydantic");
  const script=["import json,sys","from jsonschema import Draft202012Validator","sys.path.insert(0,sys.argv[2])","import chronicle_research_ontology as model","schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "for name,key in [('TaskOccurrenceRecord','task_occurrences'),('SampledQuantityObservationRecord','sampled_quantity_observations')]:",
    " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})"," for row in data[key]:","  validator.validate(row); assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
    "print('attelia-existing-shapes-preserved')"].join("\n");
  expect(execFileSync("uvx",["--from","linkml==1.10.0","--with","jsonschema","python","-c",script,schema,model],{input:JSON.stringify(input()),encoding:"utf8",timeout:60_000}).trim()).toBe("attelia-existing-shapes-preserved");
});
