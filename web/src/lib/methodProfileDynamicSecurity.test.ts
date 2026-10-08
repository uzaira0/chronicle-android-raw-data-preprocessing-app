import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson } from "@/testSupport/privateCorpus";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile } from "./methodProfiles";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { dynamicSecurityExample } from "../../e2e/fixtures/temporal-observations";
import { linkmlPython } from "../testSupport/linkmlPython";

const canonical=lazyPrivateCorpusJson<{profiles:StudyMethodProfile[]}>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
function input() {
  const profile=structuredClone(canonical().profiles.find(p=>p.source_work_id==="doi:10.1186/s13673-016-0072-3")!);
  return {profiles:[profile],...dynamicSecurityExample(profile)};
}
const setting=(v:ReturnType<typeof input>,key:string)=>v.profiles[0]!.method_settings.find(s=>s.method_parameter_key===key)!;
itWithPrivateCorpus.each([
  ["collection.call_schema", "direction", '"sideways"', /disclosed DynamicSecurity category/],
  ["collection.app_schema", "duration", "1e400", /finite supplied value/],
  ["ranker.weight_formula", "event probability", "1.1", /supplied probability domain/],
  ["collection.sms_schema", "message length", "-1", /nonnegative measure/],
  ["survey.result_matrix", "mode", "1.5", /printed exit-survey scale/],
  ["collection.app_schema", "app name", "true", /independent lexical\/numeric value or unknown/],
] as const)("rejects DynamicSecurity supplied %s %s domain contradictions", (key, property, token, error) => {
  const value = input();
  const row = value.sampled_quantity_observations.find(r => r.method_setting_reference === setting(value, key).method_setting_id)!;
  row.quantities!.find(q => q.observed_property === property)!.evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(value)).toThrow(error);
});
const answerKeys=["communication.response","app.answer_format","music.answer_format","activity.answer_format","battery.answer_format","location.map","confidence.measure","survey.protocol","survey.qualitative"];
const criterionKeys=["communication.score_threshold","app.score_formula","music.score","activity.score_formula","battery.score_formula","location.score","confidence.answer_time","threshold.session_score","threshold.decision","bayes.family"];
const sampleKeys=["collection.call_schema","collection.sms_schema","collection.app_schema","collection.music_schema","collection.activity_schema","collection.battery_schema","collection.location_schema","ranker.history_tuple","ranker.weight_formula","descriptive.accuracy_matrix","confidence.time_matrix","confidence.rank_matrix","survey.result_matrix","bayes.result_matrix","threshold.metrics"];

itWithPrivateCorpus("preserves DynamicSecurity responders/history subjects, local confidence, raw families and scoped independent outputs through import/IndexedDB/reopen",async()=>{
  const v=input(),parsed=parseStudyMethodProfileLibrary(v);
  expect(v.profiles[0]!.method_settings).toHaveLength(147);
  expect(parsed.profiles).toEqual(v.profiles);
  expect(parsed.task_occurrences).toEqual(v.task_occurrences);
  expect(parsed.sampled_quantity_observations).toEqual(v.sampled_quantity_observations);
  expect(v.task_occurrences).toHaveLength(30);expect(v.sampled_quantity_observations).toHaveLength(15);
  const common=v.task_occurrences.slice(0,3);
  expect(new Set(common.map(t=>t.participant_id)).size).toBe(3);
  expect(new Set(common.map(t=>t.history_subject_participant_id)).size).toBe(1);
  expect(new Set(common.map(t=>t.task_questionnaire_responses![0]!.assessment_case_token)).size).toBe(1);
  expect(common.every(t=>t.task_questionnaire_responses![0]!.support_task_action_references![0]===t.task_questionnaire_responses![1]!.support_task_action_references![0])).toBe(true);
  const selection={profile:parsed.profiles[0]!,selectedLevels:{},task_occurrences:parsed.task_occurrences!,sampled_quantity_observations:parsed.sampled_quantity_observations!};
  await saveResearchMethodSelection(JSON.stringify(selection));
  const saved=JSON.parse((await loadResearchMethodSelection())!) as typeof selection;expect(saved).toEqual(selection);
  expect(parseStudyMethodProfileLibrary({profiles:[saved.profile],task_occurrences:saved.task_occurrences,sampled_quantity_observations:saved.sampled_quantity_observations}).task_occurrences).toEqual(v.task_occurrences);
  const changed=input();changed.task_occurrences[1]!.task_actions![0]!.action_content_json=JSON.stringify({printed_template:"Who called your partner on <time> ?",unknown_options:true});
  expect(parseStudyMethodProfileLibrary(changed).task_occurrences).toEqual(changed.task_occurrences);
});

for(const kind of ["response","criterion","sample"] as const)for(const key of kind==="response"?answerKeys:kind==="criterion"?criterionKeys:sampleKeys){
  itWithPrivateCorpus("requires the actual DynamicSecurity "+kind+" body/source tuple independently for "+key,()=>{
    const isolate=(v:ReturnType<typeof input>)=>{
      if(kind==="sample"){v.task_occurrences=[];v.sampled_quantity_observations=v.sampled_quantity_observations.filter(r=>r.method_setting_reference===setting(v,key).method_setting_id);}
      else{
        v.sampled_quantity_observations=[];
        v.task_occurrences=v.task_occurrences.filter(t=>(kind==="response"?t.task_questionnaire_responses:t.criterion_assessments)?.some(r=>(kind==="response"?r.questionnaire_setting_reference:r.criterion_setting_reference)===setting(v,key).method_setting_id));
        for(const task of v.task_occurrences){
          if(kind==="response"){task.criterion_assessments=[];task.task_questionnaire_responses=task.task_questionnaire_responses!.filter(r=>r.questionnaire_setting_reference===setting(v,key).method_setting_id);}
          else{task.task_questionnaire_responses=[];task.criterion_assessments=task.criterion_assessments!.filter(r=>r.criterion_setting_reference===setting(v,key).method_setting_id);for(const c of task.criterion_assessments)delete c.support_criterion_assessment_references;}
        }
      }
      return v;
    };
    const v=isolate(input());expect(parseStudyMethodProfileLibrary(v)).toMatchObject({profiles:v.profiles});
    if (kind === "response") {
      const bad = structuredClone(v);
      bad.task_occurrences[0]!.task_questionnaire_responses![0]!.observed_property = "invented answer topic";
      expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("DynamicSecurity answer/topic meaning");
      if (key === "survey.protocol") {
        const wrongColumn = structuredClone(v);
        wrongColumn.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_item_label = "invented question-type column";
        expect(() => parseStudyMethodProfileLibrary(wrongColumn)).toThrow("printed Table10 question-type column");
      }
    }
    const local=setting(v,key),original:unknown=JSON.parse(String(local.method_value_json));
    const body=original!==null&&typeof original==="object"&&!Array.isArray(original)&&Object.hasOwn(original,"definition")?(original as {definition:unknown}).definition:original;
    const wrapper={definition:body,source_facing_role:local.method_setting_role,source_facing_target:local.method_target_layer};
    const wrapped=isolate(input());setting(wrapped,key).method_value_json=JSON.stringify(wrapper);expect(()=>parseStudyMethodProfileLibrary(wrapped)).not.toThrow();
    for(const corrupt of [null,"decoy",{},[body],{...wrapper,definition:null},{...wrapper,definition:false},
      {...wrapper,source_facing_role:null},{...wrapper,source_facing_target:"foreign"}, {definition:body}]){
      const bad=isolate(input());setting(bad,key).method_value_json=JSON.stringify(corrupt);expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow();
    }
    const tuple=isolate(input());setting(tuple,key).method_setting_role="provenance";expect(()=>parseStudyMethodProfileLibrary(tuple)).toThrow();
  });
}
itWithPrivateCorpus("rejects unknown/duplicate/wrong-task answer supports while preserving omitted/null/empty memberships and unknown case IDs",()=>{
  const surveySupport = input(), surveyId = setting(surveySupport, "survey.protocol").method_setting_id;
  const surveyAnswer = surveySupport.task_occurrences.flatMap(task => task.task_questionnaire_responses ?? []).find(answer => answer.questionnaire_setting_reference === surveyId)!;
  surveyAnswer.support_task_action_references = [];
  expect(() => parseStudyMethodProfileLibrary(surveySupport)).toThrow("compatible DynamicSecurity answer-local supports");
  const wrongSupportShape = input();
  Reflect.set(wrongSupportShape.task_occurrences[0]!.task_questionnaire_responses![1]!, "support_task_action_references", "constructed:security-call-in-0:answer");
  expect(() => parseStudyMethodProfileLibrary(wrongSupportShape)).toThrow("support_task_action_references must be an array or null");
  for(const references of [["unknown"],["constructed:security-call-in-1:answer"],["constructed:security-call-in-0:answer","constructed:security-call-in-0:answer"],[" "]]) {
    const v=input();v.task_occurrences[0]!.task_questionnaire_responses![1]!.support_task_action_references=references;expect(()=>parseStudyMethodProfileLibrary(v)).toThrow();
  }
  for(const reference of ["constructed:security-call-in-0:question"]) {
    const v=input();v.task_occurrences[0]!.task_questionnaire_responses![1]!.support_task_action_references=[reference];expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/non-answer action/);
  }
  for(const support of [undefined,null,[]] as const)for(const caseId of [undefined,null] as const){
    const v=input(),r=v.task_occurrences[0]!.task_questionnaire_responses![1]!;
    if(support===undefined)delete r.support_task_action_references;else r.support_task_action_references=support===null?null:[];
    if(caseId===undefined)delete r.assessment_case_token;else r.assessment_case_token=null;
    expect(parseStudyMethodProfileLibrary(v).task_occurrences).toEqual(v.task_occurrences);
  }
  const mismatched=input();mismatched.task_occurrences[0]!.task_questionnaire_responses![1]!.assessment_case_token="constructed:different-question";
  expect(()=>parseStudyMethodProfileLibrary(mismatched)).toThrow(/same answer action/);
  const incomplete=input();incomplete.task_occurrences[0]!.task_questionnaire_responses![0]!.assessment_case_token=null;
  incomplete.task_occurrences[0]!.task_questionnaire_responses![1]!.assessment_case_token="constructed:different-known-question";
  expect(()=>parseStudyMethodProfileLibrary(incomplete)).not.toThrow();
});
itWithPrivateCorpus("preserves same-case identities across responders, rejects known subject/role contradictions, and never invents unknown history subjects",()=>{
  for(const unknown of [undefined,null] as const){
    const v=input();for(const t of v.task_occurrences){if(unknown===undefined)delete t.history_subject_participant_id;else t.history_subject_participant_id=null;}
    expect(parseStudyMethodProfileLibrary(v).task_occurrences).toEqual(v.task_occurrences);
    v.task_occurrences[0]!.task_actions![1]!.assigned_role_labels=["answer","legitimate","naive adversary"];
    expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/contradictory known/);
  }
  for(const [index,subject] of [[0,"constructed:wrong-history"],[1,"constructed:security-paired-answerer"],[2,"constructed:security-stranger-answerer"]] as const){
    const v=input();v.task_occurrences[index]!.history_subject_participant_id=subject;expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/answering role\/history subject/);
  }
  const shared=input();shared.task_occurrences[1]!.history_subject_participant_id="constructed:other-known-history";
  expect(()=>parseStudyMethodProfileLibrary(shared)).toThrow(/shared question case/);
  for(const key of ["field.question_sets","field.question_identity"]){
    for(const body of [null,false,"decoy",{definition:null,source_facing_role:setting(input(),key).method_setting_role,source_facing_target:setting(input(),key).method_target_layer}]){
      const v=input();setting(v,key).method_value_json=JSON.stringify(body);expect(()=>parseStudyMethodProfileLibrary(v)).toThrow();
    }
  }
  const missing=input();missing.profiles[0]!.method_settings=missing.profiles[0]!.method_settings.filter(s=>s.method_parameter_key!=="field.question_identity");
  missing.profiles[0]!.method_setting_count=missing.profiles[0]!.method_settings.length;expect(()=>parseStudyMethodProfileLibrary(missing)).toThrow();
  for(const value of [" ",false,{}]){
    const v=input();(v.task_occurrences[0] as Record<string,unknown>).history_subject_participant_id=value;expect(()=>parseStudyMethodProfileLibrary(v)).toThrow();
  }
});
itWithPrivateCorpus("rejects case/history/answer support transplants into a foreign source without imposing globally unique local task IDs",()=>{
  const v=input(),other=structuredClone(canonical().profiles.find(p=>p.source_work_id==="doi:10.1145/2750858.2804252")!);
  const record=structuredClone(v.task_occurrences[0]!);record.method_profile_id=other.method_profile_id;record.source_work_id=other.source_work_id;
  expect(()=>parseStudyMethodProfileLibrary({profiles:[other],task_occurrences:[record]})).toThrow();
  const foreignCopy=structuredClone(other),copiedSetting=structuredClone(setting(v,"communication.response"));
  copiedSetting.source_work_id=foreignCopy.source_work_id;copiedSetting.method_setting_id="constructed:foreign-communication-definition";
  foreignCopy.method_settings.push(copiedSetting);
  foreignCopy.method_setting_count=foreignCopy.method_settings.length;
  if(Array.isArray(foreignCopy.method_setting_ids))foreignCopy.method_setting_ids.push(copiedSetting.method_setting_id);
  const responseOnly=structuredClone(record);delete responseOnly.history_subject_participant_id;
  responseOnly.task_actions=[];responseOnly.criterion_assessments=[];
  responseOnly.task_questionnaire_responses=[{questionnaire_response_id:"constructed:foreign-answer",
    questionnaire_setting_reference:copiedSetting.method_setting_id,observed_property:"incoming call person",
    response_value_json:JSON.stringify("constructed contact"),source_locators:["constructed exact foreign body-copy probe"]}];
  expect(()=>parseStudyMethodProfileLibrary({profiles:[foreignCopy],task_occurrences:[responseOnly]})).toThrow(/response-scale/);
  const duplicate=input();const record2=structuredClone(duplicate.task_occurrences[0]!);record2.participant_id="constructed:new-answerer";record2.task_label="strong adversary";
  record2.task_actions![1]!.assigned_role_labels=["answer","strong adversary"];duplicate.task_occurrences.push(record2);
  expect(()=>parseStudyMethodProfileLibrary(duplicate)).not.toThrow();
});
itWithPrivateCorpus("rejects known ordinal Boolean/structured/out-of-range values and preserves independent lexical/null/omitted responses",()=>{
  for(const key of ["confidence.measure","survey.protocol"]){
    for(const value of [true,false,[3],{x:3},0,6,1.5]){
      const v=input(),task=v.task_occurrences.find(t=>t.task_questionnaire_responses?.some(r=>r.questionnaire_setting_reference===setting(v,key).method_setting_id))!;
      task.task_questionnaire_responses!.find(r=>r.questionnaire_setting_reference===setting(v,key).method_setting_id)!.response_value_json=JSON.stringify(value);
      expect(()=>parseStudyMethodProfileLibrary(v)).toThrow();
    }
    for(const value of [undefined,null,"null",'"0"','"unreported code"'] as const){
      const v=input(),response=v.task_occurrences.find(t=>t.task_questionnaire_responses?.some(r=>r.questionnaire_setting_reference===setting(v,key).method_setting_id))!.task_questionnaire_responses!.find(r=>r.questionnaire_setting_reference===setting(v,key).method_setting_id)!;
      if(value===undefined)delete response.response_value_json;else response.response_value_json=value;
      expect(parseStudyMethodProfileLibrary(v).task_occurrences).toEqual(v.task_occurrences);
    }
  }
});
itWithPrivateCorpus("retains grouped axes/negative question accuracy and rejects known contradictory output scopes even for null/omitted values",()=>{
  const find=(v:ReturnType<typeof input>,key:string)=>v.sampled_quantity_observations.find(r=>r.method_setting_reference===setting(v,key).method_setting_id)!;
  const opaque = input(); find(opaque, "confidence.time_matrix").quantities![0]!.quantity_qualifier = "supplied opaque cohort label";
  expect(parseStudyMethodProfileLibrary(opaque).sampled_quantity_observations).toEqual(opaque.sampled_quantity_observations);
  for(const [key,qualifier] of [
    ["descriptive.accuracy_matrix","question type: Email; user type: strong adversary"],
    ["confidence.time_matrix","question type: Call; user type: invented actor"],
    ["confidence.rank_matrix","question type: App; user type: legitimate; user type: naive adversary"],
    ["survey.result_matrix","statement: invented full question; question type: Call"],
    ["survey.result_matrix","user type: strong adversary"],
    ["bayes.result_matrix","question type: App; n: 2; attack regime: strong"],
    ["threshold.metrics","question type: App; n: 7; attack regime: strong"],
  ]){
    for(const value of [undefined,null,"null"] as const){const v=input(),q=find(v,key!).quantities![0]!;q.quantity_qualifier=qualifier;
      if(value===undefined)delete q.evidence_value_json;else q.evidence_value_json=value;expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/output|scope/);}
  }
  const negative=input();find(negative,"descriptive.accuracy_matrix").quantities![0]!.evidence_value_json="-2.5000";
  expect(parseStudyMethodProfileLibrary(negative).sampled_quantity_observations).toEqual(negative.sampled_quantity_observations);
  for(const key of ["descriptive.accuracy_matrix","confidence.time_matrix","confidence.rank_matrix","survey.result_matrix","bayes.result_matrix","threshold.metrics"]){
    const v=input();find(v,key).participant_id="constructed:fake-cohort-person";expect(()=>parseStudyMethodProfileLibrary(v)).toThrow(/pooled/);
  }
  const absent=input();for(const row of absent.sampled_quantity_observations)for(const q of row.quantities??[])delete q.quantity_qualifier;
  expect(parseStudyMethodProfileLibrary(absent).sampled_quantity_observations).toEqual(absent.sampled_quantity_observations);
});
itWithPrivateCorpus("retains Table9 percentages and Table7 order separately without rescaling, sorting or borrowing ROC units",()=>{
  const v=input(),find=(source:ReturnType<typeof input>,key:string)=>source.sampled_quantity_observations.find(r=>r.method_setting_reference===setting(source,key).method_setting_id)!;
  expect(find(v,"bayes.result_matrix").quantities![0]).toMatchObject({evidence_value_json:"87.0",evidence_unit:"percent"});
  expect(parseStudyMethodProfileLibrary(v).sampled_quantity_observations).toEqual(v.sampled_quantity_observations);
  for(const value of [-1,101]){const bad=input();find(bad,"bayes.result_matrix").quantities![0]!.evidence_value_json=JSON.stringify(value);expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow();}
  for(const unit of [undefined,null,"probability","seconds"]){const bad=input(),q=find(bad,"bayes.result_matrix").quantities![0]!;
    if(unit===undefined)delete q.evidence_unit;else q.evidence_unit=unit;expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow(/evidence_unit/);}
  for(const value of [0,8,1.5]){const bad=input();find(bad,"confidence.rank_matrix").quantities!.find(q=>q.observed_property==="order")!.evidence_value_json=JSON.stringify(value);expect(()=>parseStudyMethodProfileLibrary(bad)).toThrow(/order/);}
  const independent=input();find(independent,"confidence.rank_matrix").quantities!.find(q=>q.observed_property==="mean rank")!.evidence_value_json="888.0";
  find(independent,"confidence.rank_matrix").quantities!.find(q=>q.observed_property==="order")!.evidence_value_json="1";
  expect(parseStudyMethodProfileLibrary(independent).sampled_quantity_observations).toEqual(independent.sampled_quantity_observations);
});
itWithPrivateCorpus("keeps duplicate payloads separately identified and raw event time distinct from collection time",()=>{
  const v=input(),copy=structuredClone(v.sampled_quantity_observations[0]!);copy.sampled_observation_id+=":equal-content";
  v.sampled_quantity_observations.push(copy);expect(parseStudyMethodProfileLibrary(v).sampled_quantity_observations).toEqual(v.sampled_quantity_observations);
  expect(v.sampled_quantity_observations.slice(0,7).every(row=>!Object.hasOwn(row,"observation_instant") && typeof row.source_event_time_token==="string")).toBe(true);
});
itWithPrivateCorpus("preserves the optional history identity and existing nested fields in generated JSON Schema/Pydantic shapes",()=>{
  const v=input(),schemaPath=resolve(import.meta.dirname,"../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),
    pydanticPath=resolve(import.meta.dirname,"../../schema/generated/pydantic");
  const script=["import json,sys","from jsonschema import Draft202012Validator","sys.path.insert(0,sys.argv[2])","import chronicle_research_ontology as model",
    "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "for name,key in [('TaskOccurrenceRecord','task_occurrences'),('SampledQuantityObservationRecord','sampled_quantity_observations')]:",
    " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
    " for row in data[key]:",
    "  validator.validate(row); assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
    "  assert not validator.is_valid(dict(row,invented_owner=True))",
    "print('dynamic-security-shapes-preserved')"].join("\n");
  expect(execFileSync(linkmlPython(), ["-c",script,schemaPath,pydanticPath],
    {input:JSON.stringify(v),encoding:"utf8",timeout:60_000}).trim()).toBe("dynamic-security-shapes-preserved");
});
