import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { apnomsSnapshotExample, directScreenTimeObservationExample, energyDrainObservationExample, lonelinessStepObservationExample, mommFormFactorObservationExample, moodableAvailabilityExample, participantHourObservationExample, scalarObservationExample, screenomicsHourObservationExample, temporalObservationExample } from "./fixtures/temporal-observations";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { mommSuppliedObservationExample } from "./fixtures/temporal-observations";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile, type SampledQuantityObservationRecord } from "../src/lib/methodProfiles";
import { apnomsSummaryExample, energyDrainSummaryExample, energyDrainRawObservationExample, appMembershipObservationExample, hammerObservationExample } from "./fixtures/temporal-observations";
import { taskInstrumentExamples } from "./fixtures/task-instrument-examples";
import { nextAppObservationExample, predictorObservationExample, s3ObservationExample, autosenObservationExample } from "./fixtures/temporal-observations";
import { falakiObservationExample, trafficObservationExample, depressionTrafficObservationExample } from "./fixtures/temporal-observations";
import { moodscopeObservationExample, wearableMoodObservationExample } from "./fixtures/temporal-observations";
import { mercatiGovernorObservationExample, signalPowerObservationExample } from "./fixtures/temporal-observations";
import { prefminerObservationExample, tailFourExample, assessmentTrioExample, typingMotionExample, classroomContextExample, cohortAppSummaryExample, backDeviceAuthenticationExample, timeKillingObservationExample } from "./fixtures/temporal-observations";
import { dynamicSecurityExample, atteliaObservationExample } from "./fixtures/temporal-observations";
import { communicationFeatureExample } from "./fixtures/ringer-state-interval";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const scenario of ["owner selection quarter 1", "owner selection quarter 2", "owner selection quarter 3", "owner selection quarter 4", "owner selection tail sources", "PrefMiner ownership and invalid retention", "invalid import tail relationships", "invalid import assessment relationships", "invalid import source relationships", "invalid import legacy owners", "invalid import source values and period ownership", "invalid import sampled membership and labels and clearing"] as const) {
test(`preserves scalar samples, independent participant-hour aggregates and monthly cells through ${scenario} and reload`, async ({ page }) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profiles = ["doi:10.1145/1879141.1879176", "doi:10.1038/s41598-021-82294-1", "doi:10.1145/2789168.2790107", "doi:10.1145/3313831.3376163", "doi:10.1007/s41347-024-00443-5", "doi:10.2196/13209", "doi:10.1016/j.smhl.2020.100118", "doi:10.1145/2684103.2684156", "doi:10.1109/apnoms.2011.6077030", "doi:10.1145/2745844.2745875", "doi:10.1007/s42486-020-00045-z", "doi:10.4000/questionsdecommunication.9851", "doi:10.1145/2638728.2641700", "doi:10.1145/1814433.1814453", "doi:10.1145/2634317.2634325", "doi:10.1371/journal.pone.0165331"].map(id => {
    const profile = library.profiles.find(p => p.source_work_id === id);
    if (!profile) throw new Error(`Frozen source profile absent: ${id}`);
    return profile;
  });
  const input = { profiles, ...temporalObservationExample() };
  const nextAppProfile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2684822.2685302");
  if (!nextAppProfile) throw new Error("Frozen Next App profile absent");
  // Keep the existing final recurring-hour owner and last-row regressions unchanged.
  profiles.splice(profiles.length - 1, 0, nextAppProfile);
  const s3Profile = library.profiles.find(p => p.source_work_id === "doi:10.3390/s21113765");
  if (!s3Profile) throw new Error("Frozen S3 profile absent");
  profiles.splice(profiles.length - 1, 0, s3Profile);
  const moodscopeProfile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2462456.2464449");
  if (!moodscopeProfile) throw new Error("Frozen MoodScope profile absent");
  profiles.splice(profiles.length - 1, 0, moodscopeProfile);
  const mercatiProfile = library.profiles.find(p => p.source_work_id === "source-ref:22c0acbc687e7ae7f40e");
  if (!mercatiProfile) throw new Error("Frozen Mercati profile absent");
  profiles.splice(profiles.length - 1, 0, mercatiProfile);
  const predictorProfile = library.profiles.find(p => p.source_work_id === "doi:10.1007/s00530-018-0601-1");
  if (!predictorProfile) throw new Error("Frozen Predictor profile absent");
  profiles.splice(profiles.length - 1, 0, predictorProfile);
  const autosenProfile = library.profiles.find(p => p.source_work_id === "doi:10.1109/jiot.2020.2975779");
  if (!autosenProfile) throw new Error("Frozen AUToSen profile absent");
  profiles.splice(profiles.length - 1, 0, autosenProfile);
  const energySummaries = energyDrainSummaryExample(profiles.find(p => p.source_work_id === "doi:10.1145/2745844.2745875")!);
  const energyRaw = energyDrainRawObservationExample(profiles.find(p => p.source_work_id === "doi:10.1145/2745844.2745875")!);
  const falaki = falakiObservationExample(profiles.find(p => p.source_work_id === "doi:10.1145/1814433.1814453")!);
  const direct = directScreenTimeObservationExample();
  const momm = mommFormFactorObservationExample(profiles.find(p => p.source_work_id === "doi:10.1145/2684103.2684156")!);
  const scalarInput = { ...input, sampled_quantity_observations: [...input.sampled_quantity_observations, ...scalarObservationExample(), ...lonelinessStepObservationExample(), ...momm.sampled_quantity_observations, ...apnomsSnapshotExample(), ...apnomsSummaryExample(profiles.find(p => p.source_work_id === "doi:10.1109/apnoms.2011.6077030")!), ...energyDrainObservationExample(), ...energySummaries.sampled_quantity_observations, ...energyRaw, ...falaki.sampled_quantity_observations, ...direct.sampled_quantity_observations], participant_day_observations: [...participantHourObservationExample(), ...screenomicsHourObservationExample(), ...moodableAvailabilityExample(), ...energySummaries.participant_day_observations, ...falaki.participant_day_observations, ...direct.participant_day_observations] };
  scalarInput.sampled_quantity_observations.unshift(...mommSuppliedObservationExample(profiles.find(p => p.source_work_id === "doi:10.1145/2684103.2684156")!).sampled_quantity_observations);
  const membershipInputs = ["doi:10.1007/s42486-020-00045-z", "doi:10.4000/questionsdecommunication.9851", "doi:10.1145/2638728.2641700"]
    .map(work => appMembershipObservationExample(profiles.find(p => p.source_work_id === work)!));
  // Prepend these samples: later regression still intentionally mutates the final recurring-hour row.
  scalarInput.sampled_quantity_observations.unshift(...membershipInputs.flatMap(value => value.sampled_quantity_observations));
  scalarInput.sampled_quantity_observations.unshift(...nextAppObservationExample(nextAppProfile));
  scalarInput.sampled_quantity_observations.unshift(...s3ObservationExample(s3Profile));
  scalarInput.sampled_quantity_observations.unshift(...moodscopeObservationExample(moodscopeProfile));
  scalarInput.sampled_quantity_observations.unshift(...mercatiGovernorObservationExample(mercatiProfile));
  scalarInput.sampled_quantity_observations.unshift(...predictorObservationExample(predictorProfile));
  scalarInput.sampled_quantity_observations.unshift(...autosenObservationExample(autosenProfile));
  scalarInput.participant_day_observations.push(...membershipInputs.flatMap(value => value.participant_day_observations));
  const hammer = hammerObservationExample(profiles.find(p => p.source_work_id === "doi:10.1145/2634317.2634325")!);
  scalarInput.sampled_quantity_observations.unshift(...hammer.sampled_quantity_observations);
  const traffic = trafficObservationExample(profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
  // Preserve the existing first Hammer and final Direct-owner mutation assumptions.
  scalarInput.sampled_quantity_observations.splice(scalarInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...traffic.sampled_quantity_observations);
  scalarInput.participant_day_observations.push(...traffic.participant_day_observations);
  const depressionTrafficProfile = library.profiles.find(p => p.source_work_id === "doi:10.1016/j.smhl.2020.100137");
  if (!depressionTrafficProfile) throw new Error("Frozen depression-traffic profile absent");
  profiles.splice(profiles.length - 1, 0, depressionTrafficProfile);
  const depressionTraffic = depressionTrafficObservationExample(depressionTrafficProfile);
  scalarInput.sampled_quantity_observations.splice(scalarInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...depressionTraffic.sampled_quantity_observations);
  const completeInput = { ...scalarInput, notification_histories: hammer.notification_histories, app_feature_sessions: membershipInputs.flatMap(value => value.app_feature_sessions),
    ...taskInstrumentExamples(profiles.find(p => p.source_work_id === "doi:10.4000/questionsdecommunication.9851")!) };
  completeInput.task_occurrences.push(...depressionTraffic.task_occurrences);
  const wearableProfile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2968219.2968302");
  if (!wearableProfile) throw new Error("Frozen Wearable Mood profile absent");
  profiles.splice(profiles.length - 1, 0, wearableProfile);
  const wearable = wearableMoodObservationExample(wearableProfile);
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...wearable.sampled_quantity_observations);
  completeInput.task_occurrences.push(...wearable.task_occurrences);
  const signalPowerProfile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2465529.2466586");
  if (!signalPowerProfile) throw new Error("Frozen wireless-signal profile absent");
  profiles.splice(profiles.length - 1, 0, signalPowerProfile);
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...signalPowerObservationExample(signalPowerProfile));
  const communicationFeatures = ["doi:10.1007/978-3-642-37210-0_6", "doi:10.1145/2785830.2785852"].map(work => {
    const profile = library.profiles.find(p => p.source_work_id === work);
    if (!profile) throw new Error("Frozen communication profile absent: " + work);
    profiles.splice(profiles.length - 1, 0, profile);
    return communicationFeatureExample(profile);
  });
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0,
    ...communicationFeatures.flatMap(value => value.sampled_quantity_observations));
  completeInput.participant_day_observations.push(...communicationFeatures.flatMap(value => value.participant_day_observations));
  completeInput.task_occurrences.push(...communicationFeatures.flatMap(value => value.task_occurrences));
  const typingMotion = ["doi:10.1007/978-3-319-23222-5_4","doi:10.1007/s10916-020-1530-z","doi:10.1109/tifs.2015.2506542"].map(work => {
    const profile = library.profiles.find(p => p.source_work_id === work);
    if (!profile) throw new Error("Frozen typing/motion profile absent: " + work);
    profiles.splice(profiles.length - 1, 0, profile);
    return typingMotionExample(profile);
  });
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0,
    ...typingMotion.flatMap(value => value.sampled_quantity_observations));
  completeInput.task_occurrences.push(...typingMotion.flatMap(value => value.task_occurrences));
  const assessmentTrio = ["doi:10.1177/2050157921993896","doi:10.2196/26540","doi:10.1109/mprv.2015.54"].map(work => {
    const profile = library.profiles.find(profile => profile.source_work_id === work);
    if (!profile) throw new Error("Frozen assessment source absent: " + work);
    profiles.splice(profiles.length - 1, 0, profile);
    return assessmentTrioExample(profile);
  });
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...assessmentTrio.flatMap(value => value.sampled_quantity_observations));
  completeInput.task_occurrences.push(...assessmentTrio.flatMap(value => value.task_occurrences));
  const tailFourProfiles = ["doi:10.1016/j.chb.2024.108281","doi:10.1038/s41597-026-07015-7","doi:10.1145/3131901","doi:10.5555/2442691.2442720"].map(work => {
    const profile = library.profiles.find(profile => profile.source_work_id === work);
    if (!profile) throw new Error("Frozen tail source absent: " + work);
    profiles.splice(profiles.length - 1, 0, profile);
    return profile;
  });
  const tailFour = tailFourProfiles.map(tailFourExample);
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...tailFour.flatMap(value => value.sampled_quantity_observations));
  completeInput.task_occurrences.push(...tailFour.flatMap(value => value.task_occurrences));
  const prefminerProfile = library.profiles.find(profile => profile.source_work_id === "doi:10.1145/2971648.2971747");
  if (!prefminerProfile) throw new Error("Frozen PrefMiner source absent");
  profiles.splice(profiles.length - 1, 0, prefminerProfile);
  const prefminer = prefminerObservationExample(prefminerProfile);
  completeInput.sampled_quantity_observations.splice(completeInput.sampled_quantity_observations.length - direct.sampled_quantity_observations.length, 0, ...prefminer.sampled_quantity_observations);
  completeInput.task_occurrences.push(...prefminer.task_occurrences);
  const parsed = parseStudyMethodProfileLibrary(completeInput);
  const external = trackExternalRequests(page);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => picker.setInputFiles({ name: "constructed-temporal-observations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const savedSelection = () => page.evaluate(async ({ database, store }) => {
    return new Promise<Record<string, unknown>>((resolveSaved, reject) => {
      const request = indexedDB.open(database);
      request.onerror = () => reject(new Error(request.error?.message ?? "Database open failed"));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(store, "readonly");
        const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
        tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Selection read failed")); };
        tx.oncomplete = () => {
          db.close();
          if (!read.result) { reject(new Error("Saved selection absent")); return; }
          try { resolveSaved(JSON.parse(read.result.selectionJson) as Record<string, unknown>); }
          catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
        };
      };
    });
  }, { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const assertOwner = async (id: string) => {
    const expected = { profile: parsed.profiles.find(p => p.method_profile_id === id), selectedLevels: {},
      sampled_quantity_observations: parsed.sampled_quantity_observations!.filter(r => r.method_profile_id === id),
      participant_day_observations: parsed.participant_day_observations!.filter(r => r.method_profile_id === id),
      monthly_app_use_cells: parsed.monthly_app_use_cells!.filter(r => r.method_profile_id === id),
      app_feature_sessions: parsed.app_feature_sessions!.filter(r => r.method_profile_id === id),
      task_occurrences: parsed.task_occurrences!.filter(r => r.method_profile_id === id),
      notification_histories: parsed.notification_histories!.filter(r => r.method_profile_id === id) };
    for (const [name, rows] of [["Sampled quantities", expected.sampled_quantity_observations], ["Participant-period observations", expected.participant_day_observations], ["Monthly app-use cells", expected.monthly_app_use_cells],
      ["App feature sessions", expected.app_feature_sessions], ["Task occurrences", expected.task_occurrences], ["Notification histories", expected.notification_histories]] as const) {
      const details = card.locator("details").filter({ has: page.getByText(`${name} (${rows.length})`, { exact: true }) });
      await expect(details).toHaveCount(rows.length ? 1 : 0);
      if (!rows.length) continue;
      if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      // All fields render in the same commit; read once rather than one browser round trip per field.
      const texts = await details.locator("li").allTextContents();
      for (const [index, row] of rows.entries()) for (const [key, value] of Object.entries(row)) {
        const title = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        const expected = `${title}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
        expect(texts[index]!.replace(/\s+/g, " ").trim()).toContain(expected.replace(/\s+/g, " ").trim());
      }
    }
    await expect.poll(savedSelection).toEqual(expected);
  };
  const previousProfiles = profiles.filter(profile => !tailFourProfiles.includes(profile) && profile !== prefminerProfile);
  const quarter = Math.ceil(previousProfiles.length / 4);
  const quarterIndex = ["owner selection quarter 1", "owner selection quarter 2", "owner selection quarter 3", "owner selection quarter 4"].indexOf(scenario);
  const owners = quarterIndex >= 0 ? previousProfiles.slice(quarterIndex * quarter, (quarterIndex + 1) * quarter)
    : scenario === "owner selection tail sources" ? tailFourProfiles
      : scenario === "PrefMiner ownership and invalid retention" ? [prefminerProfile] : profiles.slice(-1);
  for (const profile of owners) {
    await importValue(completeInput);
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
    await assertOwner(profile.method_profile_id);
    await reloadApp(page);
    await assertOwner(profile.method_profile_id);
  }
  if (quarterIndex >= 0 || scenario === "owner selection tail sources") {
    expect(errors).toEqual([]);
    assertNoExternalRequests(external);
    return;
  }
  const prior = await savedSelection();
  if (scenario === "PrefMiner ownership and invalid retention") {
    const bad = structuredClone(completeInput);
    const type = bad.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:prefminer-type-A")! as SampledQuantityObservationRecord;
    type.sampled_observation_references!.find(reference => reference.relationship_label === "classifier")!.sampled_observation_reference = "constructed:prefminer-classifier-B";
    await importValue(bad);
    await expect(page.getByRole("status").filter({hasText:"Method profile import failed:"})).toContainText("originating-app partition");
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(prefminerProfile.method_profile_id);
    expect(errors).toEqual([]); assertNoExternalRequests(external); return;
  }
  if (scenario === "invalid import tail relationships") {
    const crossing = structuredClone(completeInput);
    (crossing.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:corona-GPS")! as SampledQuantityObservationRecord).task_occurrence_reference = "constructed:corona-baseline";
    await importValue(crossing);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("two explicitly supplied questionnaire submissions");
    expect(await savedSelection()).toEqual(prior);
    const falseInterval = structuredClone(completeInput);
    (falseInterval.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:sleep-prediction-night-A")! as SampledQuantityObservationRecord).denotes_interval = null;
    await importValue(falseInterval);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("denotes_interval is incompatible");
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
    expect(errors).toEqual([]); assertNoExternalRequests(external); return;
  }
  if (scenario === "invalid import assessment relationships") {
    for (const [id, reference, error] of [
      ["constructed:caught-interval-AB", "constructed:caught-notification", "compatible, distinct sampled observation"],
      ["constructed:clinical-episodes-weighted", "constructed:clinical-episodes-decision-accel", "compatible, distinct sampled observation"],
    ]) {
      const bad = structuredClone(completeInput);
      const observation = bad.sampled_quantity_observations.find(row => row.sampled_observation_id === id)! as SampledQuantityObservationRecord;
      observation.sampled_observation_references![0]!.sampled_observation_reference = reference;
      await importValue(bad);
      await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(error!);
      expect(await savedSelection()).toEqual(prior);
    }
    const badWindow = structuredClone(completeInput);
    Object.assign(badWindow.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:phq8-markers-window-A")!, { task_occurrence_reference: "constructed:phq8-markers-intake" });
    await importValue(badWindow);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("actual source questionnaire completion");
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
    expect(errors).toEqual([]); assertNoExternalRequests(external); return;
  }
  if (scenario === "invalid import source relationships") {
  const invalidContact = structuredClone(completeInput);
  invalidContact.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:contact-annotation")!.quantities![0]!.evidence_value_json = '"known other contact"';
  await importValue(invalidContact);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("known recorded contact");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidSignalOwner = structuredClone(completeInput);
  delete invalidSignalOwner.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:signal-power-experiment.powermeter")!.device_id;
  await importValue(invalidSignalOwner);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("requires a supplied device owner");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidSignalProxy = structuredClone(completeInput);
  invalidSignalProxy.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:signal-power-trace.active_use")!.quantities!.find(quantity => quantity.observed_property === "active device usage")!.evidence_value_json = "false";
  await importValue(invalidSignalProxy);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("known screen-state proxy");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidWearable = structuredClone(completeInput);
  invalidWearable.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:wearable-locked")!.quantities!.find(q => q.observed_property === "foreground application")!.evidence_value_json = '"known app"';
  await importValue(invalidWearable);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("locked-empty");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidMercati = structuredClone(completeInput);
  invalidMercati.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:mercati-allocation-1")!.quantities![0]!.evidence_value_json = '"Idle"';
  await importValue(invalidMercati);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("Mercati allocation/frequency context");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidMoodScope = structuredClone(completeInput);
  const feedback = invalidMoodScope.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:moodscope-feedback-A")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
  feedback.sampled_observation_references![0]!.sampled_observation_reference = "constructed:moodscope-current-A";
  await importValue(invalidMoodScope);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("compatible, distinct sampled observation");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const badPredictor = structuredClone(completeInput);
  const predictorFeature = badPredictor.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:predictor-features-A")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
  predictorFeature.sampled_observation_references![8]!.sampled_observation_reference = "constructed:predictor-context-1";
  await importValue(badPredictor);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("declared action family");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  for (const [id, mutation, message] of [
    ["app-transfer-A", "application", "known application owner"],
    ["transfer-A", "flow", "supplied TCP flow"],
    ["packet-1", "collector", "platform/collector pairing"],
  ] as const) {
    const invalidTraffic = structuredClone(completeInput);
    const trafficRow = invalidTraffic.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:traffic-" + id)! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
    if (mutation === "application") trafficRow.observed_entity_token = "constructed:app-B";
    else if (mutation === "flow") trafficRow.sampled_observation_references![0]!.sampled_observation_reference = "constructed:traffic-flow-B";
    else trafficRow.quantities!.find(q => q.observed_property === "capture collector")!.evidence_value_json = '"Netlog"';
    await importValue(invalidTraffic);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  }
for (const [id, mutation, message] of [
    ["gate-0", "platform", "known iOS packet"],
    ["within-A", "external-IP", "known supplied external IP address a"],
    ["features.aggregate_usage-A", "completion", "independent PHQ completions"],
  ] as const) {
    const invalidDepressionTraffic = structuredClone(completeInput);
    const target = invalidDepressionTraffic.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:depression-traffic-" + id)! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
    if (mutation === "platform") target.sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-iOS-independent";
    else if (mutation === "external-IP") target.sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-bin-C";
    else target.sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-window-B";
    await importValue(invalidDepressionTraffic);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  }
  }
  if (scenario === "invalid import legacy owners") {
  const badNextApp = structuredClone(completeInput);
  const nextFeature = badNextApp.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:next-features-A")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
  nextFeature.sampled_observation_references![0]!.sampled_observation_reference = "constructed:next-raw-3";
  await importValue(badNextApp);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("declared action family");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const foreignRoot = structuredClone(completeInput);
  Reflect.set(foreignRoot.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:wifi-place-a")!, "root_entity_member_reference", "appearance-a");
  await importValue(foreignRoot);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("resolve within its own entity members");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page);
  await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalid = structuredClone(input);
  Reflect.set(invalid.monthly_app_use_cells[0]!, "used_in_month", false);
  await importValue(invalid);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("must be numeric 0, 1 or null");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page);
  await assertOwner(profiles.at(-1)!.method_profile_id);
  const wrongEnergyOwner = structuredClone(completeInput);
  wrongEnergyOwner.sampled_quantity_observations.find(row => row.source_work_id === "doi:10.1145/2745844.2745875")!.observed_entity_kind = "process";
  await importValue(wrongEnergyOwner);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("observed_entity_kind must be android_uid");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const wrongAppUnit = structuredClone(scalarInput);
  wrongAppUnit.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:app-energy-0")!.quantities![0]!.evidence_unit = "mW";
  await importValue(wrongAppUnit);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("evidence_unit must be mAh");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const missingUidParticipant = structuredClone(scalarInput);
  Reflect.deleteProperty(missingUidParticipant.sampled_quantity_observations.find(row => row.source_work_id === "doi:10.1145/2745844.2745875" && row.observed_entity_kind === "android_uid")!, "participant_id");
  await importValue(missingUidParticipant);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("participant_id");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  for (const [id, value, message] of [
    ["constructed:energy-event-4", '"ON"', "disclosed categorical state"],
    ["constructed:energy-raw-brightness", "percent", "source unit unspecified"],
    ["constructed:energy-uid-input-A", "milliseconds", "evidence_unit must be seconds"],
  ] as const) {
    const invalidRaw = structuredClone(completeInput);
    const row = invalidRaw.sampled_quantity_observations.find(item => item.sampled_observation_id === id)!;
    if (id === "constructed:energy-event-4") row.quantities![0]!.evidence_value_json = value;
    else row.quantities![id === "constructed:energy-uid-input-A" ? 2 : 0]!.evidence_unit = value;
    await importValue(invalidRaw);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  }
  } else if (scenario === "invalid import source values and period ownership") {
  for (const [id, field, value, message] of [
    ["timer-A", "evidence_unit", "seconds", "source unit unspecified"],
    ["screen-off", "evidence_value_json", '"screen turned off"', "disclosed categorical state"],
    ["trend-table-0", "quantity_qualifier", "2-hour horizon", "one supplied following-window horizon"],
  ] as const) {
    const invalidFalaki = structuredClone(completeInput);
    const row = invalidFalaki.sampled_quantity_observations.find(item => item.sampled_observation_id === "constructed:falaki-" + id)!;
    Reflect.set(row.quantities![id === "trend-table-0" ? 4 : 0]!, field, value);
    await importValue(invalidFalaki);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  }
  const missingFalakiParticipant = structuredClone(completeInput);
  Reflect.deleteProperty(missingFalakiParticipant.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:falaki-timer-A")!, "participant_id");
  await importValue(missingFalakiParticipant);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("participant_id");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const wrongRecurringHour = structuredClone(completeInput);
  Reflect.set(wrongRecurringHour.sampled_quantity_observations.at(-1)!.quantities![2]!, "quantity_qualifier", "example:particular-hour-0");
  await importValue(wrongRecurringHour);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("incompatible source-defined variant");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page);
  await assertOwner(profiles.at(-1)!.method_profile_id);
  const ambiguous = structuredClone(completeInput);
  const wrongBatteryState = structuredClone(completeInput);
  wrongBatteryState.sampled_quantity_observations.find(row => row.source_work_id === "doi:10.1109/apnoms.2011.6077030")!.quantities!.find(quantity => quantity.observed_property === "battery status")!.evidence_value_json = '"Charging"';
  await importValue(wrongBatteryState);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("disclosed categorical state");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  Reflect.set(ambiguous.participant_day_observations[0]!, "referenced_day_token", null);
  await importValue(ambiguous);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("exactly one referenced day, hour or night");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page);
  await assertOwner(profiles.at(-1)!.method_profile_id);
  const ambiguousRun = structuredClone(completeInput);
  Reflect.set(ambiguousRun.participant_day_observations.find(row => Object.hasOwn(row, "referenced_run_token"))!, "referenced_day_token", null);
  await importValue(ambiguousRun);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("exactly one referenced");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page);
  await assertOwner(profiles.at(-1)!.method_profile_id);
  } else if (scenario === "invalid import sampled membership and labels and clearing") {
  for (const mutate of [
    (candidate: typeof completeInput) => { (candidate.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:installed-inventory-a")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord).entity_members![0]!.quantities![0]!.evidence_value_json = '"running"'; },
    (candidate: typeof completeInput) => { (candidate.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:running-snapshot-a")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord).entity_members![0]!.member_entity_kind = "cell"; },
  ]) {
    const invalidMembership = structuredClone(completeInput); mutate(invalidMembership);
    await importValue(invalidMembership);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toBeVisible();
    expect(await savedSelection()).toEqual(prior);
    await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  }
  const invalidHammer = structuredClone(completeInput);
  invalidHammer.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:hammer-frame-a")!.quantities!.find(q => q.observed_property === "human confidence")!.evidence_value_json = "90";
  await importValue(invalidHammer);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("confidence");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidAutosen = structuredClone(completeInput);
  const autosenModel = invalidAutosen.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:autosen-model-A")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
  autosenModel.sampled_observation_references![1]!.sampled_observation_reference = "constructed:autosen-sequence-ToAcGrMaEl";
  await importValue(invalidAutosen);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("another supplied user's");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidS3 = structuredClone(completeInput);
  invalidS3.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:s3-nontarget")!.quantities!.find(q => q.observed_property === "label")!.evidence_value_json = '"target"';
  await importValue(invalidS3);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("target/nontarget user relationship");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  const invalidRecent = structuredClone(completeInput);
  const recentRow = invalidRecent.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:recent-snapshot-a")! as import("../src/lib/methodProfiles").SampledQuantityObservationRecord;
  recentRow.entity_members![0]!.quantities!.find(q => q.observed_property === "source rank")!.evidence_value_json = "10";
  await importValue(invalidRecent);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toBeVisible();
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(profiles.at(-1)!.method_profile_id);
  await importValue({ profiles: [profiles[1]], sampled_quantity_observations: [], monthly_app_use_cells: [] });
  await expect.poll(savedSelection).toEqual({ profile: parsed.profiles[1], selectedLevels: {}, sampled_quantity_observations: [], monthly_app_use_cells: [] });
  await reloadApp(page);
  await expect(card).not.toContainText("Monthly app-use cells");
  await importValue({ profiles: [profiles[1]] });
  await expect.poll(savedSelection).toEqual({ profile: parsed.profiles[1], selectedLevels: {} });
  await reloadApp(page);
  expect(await savedSelection()).toEqual({ profile: parsed.profiles[1], selectedLevels: {} });
  }
  expect(errors).toEqual([]);
  assertNoExternalRequests(external);
});
}

for (const work of ["doi:10.1016/j.compedu.2019.103611", "doi:10.1177/0956797620956613"]) {
test("preserves supplied student/course/class ownership and independent denominator through the actual workflow: " + work, async ({ page }) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profiles = ["doi:10.1016/j.compedu.2019.103611","doi:10.1177/0956797620956613"].map(id => library.profiles.find(p => p.source_work_id === id)!);
  const examples = profiles.map(classroomContextExample);
  const input = { profiles, sampled_quantity_observations: examples.flatMap(v => v.sampled_quantity_observations),
    participant_day_observations: examples.flatMap(v => v.participant_day_observations),
    task_occurrences: examples.flatMap(v => v.task_occurrences), device_use_sessions: examples.flatMap(v => v.device_use_sessions) };
  const parsed = parseStudyMethodProfileLibrary(input), profile = parsed.profiles.find(p => p.source_work_id === work)!;
  const external = trackExternalRequests(page), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await gotoApp(page);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => page.getByTestId("method-profile-file-input").setInputFiles({
    name: "constructed-classroom-context.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const saved = () => page.evaluate(async ({ database,store }) => new Promise<Record<string,unknown>>((resolveSaved,reject) => {
    const request = indexedDB.open(database);
    request.onerror = () => reject(new Error(request.error?.message ?? "Database open failed"));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(store,"readonly");
      const read = tx.objectStore(store).get("research-selection") as IDBRequest<{selectionJson:string}|undefined>;
      tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Selection read failed")); };
      tx.oncomplete = () => {
        db.close();
        if (!read.result) { reject(new Error("Saved selection absent")); return; }
        try { resolveSaved(JSON.parse(read.result.selectionJson) as Record<string,unknown>); }
        catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
      };
    };
  }), { database:LAST_RUN_DB_NAME,store:LAST_RUN_STORE_NAME });
  const expected = { profile,selectedLevels:{},
    sampled_quantity_observations: parsed.sampled_quantity_observations!.filter(r => r.method_profile_id === profile.method_profile_id),
    participant_day_observations: parsed.participant_day_observations!.filter(r => r.method_profile_id === profile.method_profile_id),
    task_occurrences: parsed.task_occurrences!.filter(r => r.method_profile_id === profile.method_profile_id),
    device_use_sessions: parsed.device_use_sessions!.filter(r => r.method_profile_id === profile.method_profile_id) };
  const assertOwner = async () => {
    for (const [label,rows] of [["Sampled quantities",expected.sampled_quantity_observations],
      ["Participant-period observations",expected.participant_day_observations],["Task occurrences",expected.task_occurrences],
      ["Device-use sessions",expected.device_use_sessions]] as const) {
      const details = card.locator("details").filter({ has: page.getByText(label+" ("+rows.length+")",{exact:true}) });
      await expect(details).toHaveCount(rows.length ? 1 : 0);
      if (!rows.length) continue;
      if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      const texts = await details.locator("li").allTextContents();
      for (const [i,row] of rows.entries()) for (const [key,value] of Object.entries(row)) {
        const title = key.replaceAll("_"," ").replace(/^./,letter => letter.toUpperCase());
        const rendered = title+": "+(typeof value === "string" ? value : JSON.stringify(value));
        expect(texts[i]!.replace(/\s+/g," ").trim()).toContain(rendered.replace(/\s+/g," ").trim());
      }
    }
    await expect.poll(saved).toEqual(expected);
  };
  await importValue(input);
  await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(profile.method_profile_id);
  await assertOwner(); await reloadApp(page); await assertOwner();
  const prior = await saved();
  const wrong = structuredClone(input), use = wrong.sampled_quantity_observations.find(r =>
    r.method_profile_id === profile.method_profile_id && r.sampled_observation_id === "constructed:classroom-use-A")!;
  const support = wrong.sampled_quantity_observations.find(r => r.method_profile_id === profile.method_profile_id
    && r.sampled_observation_id === "constructed:classroom-attendance-A")!;
  support.observed_entity_token = "known other supplied course";
  expect(use.sampled_observation_references!.length).toBeGreaterThan(0);
  await importValue(wrong);
  await expect(page.getByRole("status").filter({hasText:"Method profile import failed:"})).toBeVisible();
  expect(await saved()).toEqual(prior); await reloadApp(page); await assertOwner();
  await importValue({profiles:[profile],sampled_quantity_observations:[],participant_day_observations:[],task_occurrences:[],device_use_sessions:[]});
  await expect.poll(saved).toEqual({profile,selectedLevels:{},sampled_quantity_observations:[],participant_day_observations:[],task_occurrences:[],device_use_sessions:[]});
  await reloadApp(page);
  await expect(card).not.toContainText("Sampled quantities");
  await importValue({profiles:[profile]});
  await expect.poll(saved).toEqual({profile,selectedLevels:{}});
  await reloadApp(page); expect(await saved()).toEqual({profile,selectedLevels:{}});
  expect(errors).toEqual([]); assertNoExternalRequests(external);
});
}

for (const work of ["doi:10.1145/2037373.2037383","doi:10.1016/j.compedu.2019.103611"]) {
test("preserves explicit aggregate app/category/cohort scopes through actual import/select/save/reload: " + work, async ({page}) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"),"utf8")) as {profiles:StudyMethodProfile[]};
  const profiles = ["doi:10.1145/2037373.2037383","doi:10.1016/j.compedu.2019.103611"].map(id => library.profiles.find(p => p.source_work_id === id)!);
  const input = {profiles,sampled_quantity_observations:profiles.flatMap(cohortAppSummaryExample)};
  const parsed = parseStudyMethodProfileLibrary(input), profile = parsed.profiles.find(p => p.source_work_id === work)!;
  const records = parsed.sampled_quantity_observations!.filter(r => r.method_profile_id === profile.method_profile_id);
  const expected = {profile,selectedLevels:{},sampled_quantity_observations:records};
  const external = trackExternalRequests(page), errors:string[] = [];
  page.on("pageerror", e => errors.push(e.message)); await gotoApp(page);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value:unknown) => page.getByTestId("method-profile-file-input").setInputFiles({
    name:"constructed-cohort-app-summary.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(value))});
  const saved = () => page.evaluate(async ({database,store}) => new Promise<Record<string,unknown>>((resolveSaved,reject) => {
    const request = indexedDB.open(database);
    request.onerror = () => reject(new Error(request.error?.message ?? "Database open failed"));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(store,"readonly");
      const read = tx.objectStore(store).get("research-selection") as IDBRequest<{selectionJson:string}|undefined>;
      tx.onerror = () => {db.close();reject(new Error(tx.error?.message ?? "Selection read failed"));};
      tx.oncomplete = () => {
        db.close(); if (!read.result) {reject(new Error("Saved selection absent"));return;}
        try {resolveSaved(JSON.parse(read.result.selectionJson) as Record<string,unknown>);}
        catch(e) {reject(e instanceof Error ? e : new Error(String(e)));}
      };
    };
  }),{database:LAST_RUN_DB_NAME,store:LAST_RUN_STORE_NAME});
  const assertOwner = async () => {
    const details = card.locator("details").filter({has:page.getByText("Sampled quantities ("+records.length+")",{exact:true})});
    await expect(details).toHaveCount(1);
    if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
    await expect(details.locator("li")).toHaveCount(records.length);
    const texts = await details.locator("li").allTextContents();
    for (const [i,row] of records.entries()) for (const [key,value] of Object.entries(row)) {
      const rendered = key.replaceAll("_"," ").replace(/^./,letter => letter.toUpperCase())+": "+(typeof value === "string" ? value : JSON.stringify(value));
      expect(texts[i]!.replace(/\s+/g," ").trim()).toContain(rendered.replace(/\s+/g," ").trim());
    }
    await expect.poll(saved).toEqual(expected);
  };
  await importValue(input);
  await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(profile.method_profile_id);
  await assertOwner(); await reloadApp(page); await assertOwner();
  const prior = await saved(), wrong = structuredClone(input);
  wrong.sampled_quantity_observations.find(r => r.method_profile_id === profile.method_profile_id)!.participant_id = "fabricated cohort participant";
  await importValue(wrong); await expect(page.getByRole("status").filter({hasText:"Method profile import failed:"})).toContainText("known individual participant/device");
  expect(await saved()).toEqual(prior); await reloadApp(page); await assertOwner();
  await importValue({profiles:[profile],sampled_quantity_observations:[]});
  await expect.poll(saved).toEqual({profile,selectedLevels:{},sampled_quantity_observations:[]});
  await reloadApp(page); await expect(card).not.toContainText("Sampled quantities");
  await importValue({profiles:[profile]}); await expect.poll(saved).toEqual({profile,selectedLevels:{}});
  await reloadApp(page); expect(await saved()).toEqual({profile,selectedLevels:{}});
  expect(errors).toEqual([]); assertNoExternalRequests(external);
});
}

test("preserves Back-of-device rear/front stages, ordered shapes and independent Tasks through import/select/save/reload and rejected replacement", async ({ page }) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2470654.2481330");
  if (!profile) throw new Error("Frozen Back-of-device profile absent");
  const example = backDeviceAuthenticationExample(profile), alternateProfile = structuredClone(profile);
  alternateProfile.method_profile_id = "constructed:alternate-back-owner";
  const alternate = structuredClone(example);
  for (const row of [...alternate.sampled_quantity_observations, ...alternate.task_occurrences]) row.method_profile_id = alternateProfile.method_profile_id;
  const input = { profiles: [profile, alternateProfile], sampled_quantity_observations: [...example.sampled_quantity_observations, ...alternate.sampled_quantity_observations],
    task_occurrences: [...example.task_occurrences, ...alternate.task_occurrences] };
  const external = trackExternalRequests(page), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await gotoApp(page);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => page.getByTestId("method-profile-file-input").setInputFiles({
    name: "constructed-back-of-device.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
  });
  const savedSelection = () => page.evaluate(async ({ database, store }) => {
    return new Promise<Record<string, unknown>>((resolveSaved, reject) => {
      const request = indexedDB.open(database);
      request.onerror = () => reject(new Error(request.error?.message ?? "Database open failed"));
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(store, "readonly");
        const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
        tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Selection read failed")); };
        tx.oncomplete = () => {
          db.close(); if (!read.result) { reject(new Error("Saved selection absent")); return; }
          try { resolveSaved(JSON.parse(read.result.selectionJson) as Record<string, unknown>); }
          catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        };
      };
    });
  }, { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const assertOwner = async (owner: StudyMethodProfile) => {
    const expected = { profile: owner, selectedLevels: {}, sampled_quantity_observations: input.sampled_quantity_observations.filter(r => r.method_profile_id === owner.method_profile_id),
      task_occurrences: input.task_occurrences.filter(r => r.method_profile_id === owner.method_profile_id) };
    for (const [title, rows] of [["Sampled quantities", expected.sampled_quantity_observations], ["Task occurrences", expected.task_occurrences]] as const) {
      const details = card.locator("details").filter({ has: page.getByText(title + " (" + rows.length + ")", { exact: true }) });
      await expect(details).toHaveCount(1);
      if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      const texts = await details.locator("li").allTextContents();
      for (const [i, row] of rows.entries()) for (const [key, value] of Object.entries(row)) {
        const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        expect(texts[i]!.replace(/\s+/g, " ").trim()).toContain((label + ": " + (typeof value === "string" ? value : JSON.stringify(value))).replace(/\s+/g, " ").trim());
      }
    }
    await expect.poll(savedSelection).toEqual(expected);
  };
  for (const owner of [profile, alternateProfile]) {
    // Reload restores only the selected owner; reimport before switching owners.
    await importValue(input);
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(owner.method_profile_id);
    await assertOwner(owner); await reloadApp(page); await assertOwner(owner);
  }
  const prior = await savedSelection(), invalid = structuredClone(input);
  invalid.sampled_quantity_observations.find(r => r.method_profile_id === alternateProfile.method_profile_id && r.sampled_observation_id === "constructed:back-rear-points")!.participant_id = "constructed:foreign-person";
  await importValue(invalid);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("compatible, distinct sampled observation");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(alternateProfile);
  for (const empty of [{ sampled_quantity_observations: [], task_occurrences: [] }, {}]) {
    await importValue({ profiles: [profile], ...empty });
    const saved = { profile, selectedLevels: {}, ...empty };
    await expect.poll(savedSelection).toEqual(saved);
    await reloadApp(page); await expect.poll(savedSelection).toEqual(saved);
    await expect(card.locator("details").filter({ has: page.getByText(/Sampled quantities \(|Task occurrences \(/) })).toHaveCount(0);
  }
  expect(errors).toEqual([]); assertNoExternalRequests(external);
});


for (const scenario of ["owner selection","invalid retention and clearing"] as const) {
test("preserves DynamicSecurity shared cases/history subjects and independently scoped outputs through "+scenario,async({page})=>{
  const library=JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"),"utf8")) as {profiles:StudyMethodProfile[]};
  const profile=library.profiles.find(p=>p.source_work_id==="doi:10.1186/s13673-016-0072-3");
  if(!profile)throw new Error("Frozen DynamicSecurity source absent");
  const example=dynamicSecurityExample(profile),otherProfile=structuredClone(profile),other=structuredClone(example);
  otherProfile.method_profile_id="constructed:alternate-dynamic-security-owner";
  const channels=["sampled_quantity_observations","task_occurrences"] as const;
  for(const channel of channels)for(const row of other[channel])row.method_profile_id=otherProfile.method_profile_id;
  const input={profiles:[profile,otherProfile],...Object.fromEntries(channels.map(channel=>[channel,[...example[channel],...other[channel]]]))};
  const external=trackExternalRequests(page),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await gotoApp(page);const card=page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue=(value:unknown)=>page.getByTestId("method-profile-file-input").setInputFiles({
    name:"constructed-dynamic-security.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(value)),
  });
  const savedSelection=()=>page.evaluate(async({database,store})=>{
    return new Promise<Record<string,unknown>>((resolveSaved,reject)=>{
      const request=indexedDB.open(database);request.onerror=()=>reject(new Error(request.error?.message??"Database open failed"));
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(store,"readonly"),read=tx.objectStore(store).get("research-selection") as IDBRequest<{selectionJson:string}|undefined>;
        tx.onerror=()=>{db.close();reject(new Error(tx.error?.message??"Selection read failed"));};
        tx.oncomplete=()=>{db.close();if(!read.result){reject(new Error("Saved selection absent"));return;}
          try{resolveSaved(JSON.parse(read.result.selectionJson) as Record<string,unknown>);}catch(error){reject(error instanceof Error?error:new Error(String(error)));}};
      };
    });
  },{database:LAST_RUN_DB_NAME,store:LAST_RUN_STORE_NAME});
  const headings={sampled_quantity_observations:"Sampled quantities",task_occurrences:"Task occurrences"};
  const assertOwner=async(owner:StudyMethodProfile,records:typeof example)=>{
    for(const channel of channels){
      const rows=records[channel],details=card.locator("details").filter({has:page.getByText(headings[channel]+" ("+rows.length+")",{exact:true})});
      if(!await details.evaluate(el=>(el as HTMLDetailsElement).open))await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      const rendered=(await details.locator("li").allTextContents()).map(t=>t.replace(/\s+/g," ").trim());
      rows.forEach((row,index)=>{for(const [key,value] of Object.entries(row)){
        const label=key.replaceAll("_"," ").replace(/^./,letter=>letter.toUpperCase()),payload=typeof value==="string"?value:JSON.stringify(value);
        expect(rendered[index]).toContain((label+": "+payload).replace(/\s+/g," ").trim());
      }});
    }
    await expect.poll(savedSelection).toEqual({profile:owner,selectedLevels:{},...records});
  };
  if(scenario==="owner selection"){
    for(const [owner,records] of [[profile,example],[otherProfile,other]] as const){
      await importValue(input);
      await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(owner.method_profile_id);
      await assertOwner(owner,records);await reloadApp(page);await assertOwner(owner,records);
    }
  }else{
    await importValue(input);
    await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(otherProfile.method_profile_id);
    await assertOwner(otherProfile,other);
    const prior=await savedSelection(),invalid=structuredClone(other);
    invalid.task_occurrences[0]!.task_questionnaire_responses![1]!.assessment_case_token="constructed:wrong-known-question";
    await importValue({profiles:[otherProfile],...invalid});
    await expect(page.getByRole("status").filter({hasText:"Method profile import failed:"})).toContainText("same answer action");
    expect(await savedSelection()).toEqual(prior);await reloadApp(page);await assertOwner(otherProfile,other);
    for(const records of [Object.fromEntries(channels.map(channel=>[channel,[]])),{}]){
      await importValue({profiles:[profile],...records});await expect.poll(savedSelection).toEqual({profile,selectedLevels:{},...records});
      await reloadApp(page);await expect.poll(savedSelection).toEqual({profile,selectedLevels:{},...records});
      for(const heading of Object.values(headings))await expect(card.locator("details").filter({has:page.getByText(new RegExp("^"+heading+" \\("))})).toHaveCount(0);
    }
  }
  expect(errors).toEqual([]);assertNoExternalRequests(external);
});
}

test("preserves TimeKilling phone-use parents, seven-pair supports, source topics and independent outputs through import/select/save/reload/rejection",async({page})=>{
  const library=JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"),"utf8")) as {profiles:StudyMethodProfile[]};
  const profile=library.profiles.find(p=>p.source_work_id==="doi:10.1145/3544548.3580689");
  if(!profile)throw new Error("Frozen TimeKilling source absent");
  const example=timeKillingObservationExample(profile),otherProfile=structuredClone(profile),other=structuredClone(example);
  otherProfile.method_profile_id="constructed:alternate-time-killing-owner";
  const channels=["sampled_quantity_observations","screenshot_sessions","device_use_sessions","task_occurrences","notification_histories"] as const;
  for(const channel of channels)for(const row of other[channel])row.method_profile_id=otherProfile.method_profile_id;
  const input={profiles:[profile,otherProfile],...Object.fromEntries(channels.map(channel=>[channel,[...example[channel],...other[channel]]]))};
  const external=trackExternalRequests(page),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await gotoApp(page);
  const card=page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue=(value:unknown)=>page.getByTestId("method-profile-file-input").setInputFiles({
    name:"constructed-time-killing.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(value)),
  });
  const savedSelection=()=>page.evaluate(async({database,store})=>{
    return new Promise<Record<string,unknown>>((resolveSaved,reject)=>{
      const request=indexedDB.open(database);request.onerror=()=>reject(new Error(request.error?.message??"Database open failed"));
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(store,"readonly"),read=tx.objectStore(store).get("research-selection") as IDBRequest<{selectionJson:string}|undefined>;
        tx.onerror=()=>{db.close();reject(new Error(tx.error?.message??"Selection read failed"));};
        tx.oncomplete=()=>{db.close();if(!read.result){reject(new Error("Saved selection absent"));return;}
          try{resolveSaved(JSON.parse(read.result.selectionJson) as Record<string,unknown>);}catch(error){reject(error instanceof Error?error:new Error(String(error)));}};
      };
    });
  },{database:LAST_RUN_DB_NAME,store:LAST_RUN_STORE_NAME});
  const headings={sampled_quantity_observations:"Sampled quantities",screenshot_sessions:"Screenshot sessions",device_use_sessions:"Device-use sessions",
    task_occurrences:"Task occurrences",notification_histories:"Notification histories"};
  const assertOwner=async(owner:StudyMethodProfile,records:typeof example)=>{
    for(const channel of channels){
      const rows=records[channel],details=card.locator("details").filter({has:page.getByText(headings[channel]+" ("+rows.length+")",{exact:true})});
      if(!await details.evaluate(el=>(el as HTMLDetailsElement).open))await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      const rendered=(await details.locator("li").allTextContents()).map(t=>t.replace(/\s+/g," ").trim());
      rows.forEach((row,index)=>{for(const [key,value] of Object.entries(row)){
        const label=key.replaceAll("_"," ").replace(/^./,letter=>letter.toUpperCase()),payload=typeof value==="string"?value:JSON.stringify(value);
        expect(rendered[index]).toContain((label+": "+payload).replace(/\s+/g," ").trim());
      }});
    }
    await expect.poll(savedSelection).toEqual({profile:owner,selectedLevels:{},...records});
  };
  for(const [owner,records] of [[profile,example],[otherProfile,other]] as const){
    await importValue(input);
    await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(owner.method_profile_id);
    await assertOwner(owner,records);await reloadApp(page);await assertOwner(owner,records);
  }
  const prior=await savedSelection(),invalid=structuredClone(other);
  invalid.sampled_quantity_observations.find(r=>r.sampled_observation_id==="constructed:time-killing-battery")!.screenshot_record_reference="image-A";
  await importValue({profiles:[otherProfile],...invalid});
  await expect(page.getByRole("status").filter({hasText:"Method profile import failed:"})).toContainText("known supplied screenshot-pair identity");
  expect(await savedSelection()).toEqual(prior);await reloadApp(page);await assertOwner(otherProfile,other);
  for(const records of [Object.fromEntries(channels.map(channel=>[channel,[]])),{}]){
    await importValue({profiles:[profile],...records});await expect.poll(savedSelection).toEqual({profile,selectedLevels:{},...records});
    await reloadApp(page);await expect.poll(savedSelection).toEqual({profile,selectedLevels:{},...records});
    for(const heading of Object.values(headings))await expect(card.locator("details").filter({has:page.getByText(new RegExp("^"+heading+" \\("))})).toHaveCount(0);
  }
  expect(errors).toEqual([]);assertNoExternalRequests(external);
});

for (const scenario of ["owner selection","invalid retention and clearing"] as const) {
test("preserves Attelia cross-device detector evidence and recipient-owned ESMs through "+scenario,async({page})=>{
  const library=JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"),"utf8")) as {profiles:StudyMethodProfile[]};
  const profile=library.profiles.find(p=>p.source_work_id==="doi:10.1145/2750858.2807517");
  if(!profile)throw new Error("Frozen Attelia source absent");
  const example=atteliaObservationExample(profile),otherProfile=structuredClone(profile),other=structuredClone(example);
  otherProfile.method_profile_id="constructed:alternate-attelia-owner";
  const channels=["sampled_quantity_observations","task_occurrences"] as const;
  for(const channel of channels)for(const row of other[channel])row.method_profile_id=otherProfile.method_profile_id;
  const input={profiles:[profile,otherProfile],...Object.fromEntries(channels.map(channel=>[channel,[...example[channel],...other[channel]]]))};
  const external=trackExternalRequests(page),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await gotoApp(page);const card=page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue=(value:unknown)=>page.getByTestId("method-profile-file-input").setInputFiles({
    name:"constructed-attelia.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(value)),
  });
  const savedSelection=()=>page.evaluate(async({database,store})=>{
    return new Promise<Record<string,unknown>>((resolveSaved,reject)=>{
      const request=indexedDB.open(database);request.onerror=()=>reject(new Error(request.error?.message??"Database open failed"));
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(store,"readonly"),read=tx.objectStore(store).get("research-selection") as IDBRequest<{selectionJson:string}|undefined>;
        tx.onerror=()=>{db.close();reject(new Error(tx.error?.message??"Selection read failed"));};
        tx.oncomplete=()=>{db.close();if(!read.result){reject(new Error("Saved selection absent"));return;}
          try{resolveSaved(JSON.parse(read.result.selectionJson) as Record<string,unknown>);}catch(error){reject(error instanceof Error?error:new Error(String(error)));}};
      };
    });
  },{database:LAST_RUN_DB_NAME,store:LAST_RUN_STORE_NAME});
  const headings={sampled_quantity_observations:"Sampled quantities",task_occurrences:"Task occurrences"};
  const assertOwner=async(owner:StudyMethodProfile,records:typeof example)=>{
    for(const channel of channels){
      const rows=records[channel],details=card.locator("details").filter({has:page.getByText(headings[channel]+" ("+rows.length+")",{exact:true})});
      if(!await details.evaluate(el=>(el as HTMLDetailsElement).open))await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      const rendered=(await details.locator("li").allTextContents()).map(t=>t.replace(/\s+/g," ").trim());
      rows.forEach((row,index)=>{for(const [key,value] of Object.entries(row)){
        const label=key.replaceAll("_"," ").replace(/^./,letter=>letter.toUpperCase()),payload=typeof value==="string"?value:JSON.stringify(value);
        expect(rendered[index]).toContain((label+": "+payload).replace(/\s+/g," ").trim());
      }});
    }
    await expect.poll(savedSelection).toEqual({profile:owner,selectedLevels:{},...records});
  };
  if(scenario==="owner selection"){
    for(const [owner,records] of [[profile,example],[otherProfile,other]] as const){
      await importValue(input);
      await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(owner.method_profile_id);
      await assertOwner(owner,records);await reloadApp(page);await assertOwner(owner,records);
    }
  }else{
    await importValue(input);
    await card.getByRole("combobox",{name:"Profile",exact:true}).selectOption(otherProfile.method_profile_id);
    await assertOwner(otherProfile,other);
    const prior=await savedSelection(),invalid=structuredClone(other);
    invalid.sampled_quantity_observations.find(r=>r.sampled_observation_id==="constructed:attelia-delivery-phone")!.quantities![0]!.evidence_value_json='"watch"';
    await importValue({profiles:[otherProfile],...invalid});
    await expect(page.getByRole("status").filter({hasText:"Method profile import failed:"})).toContainText("phone-use proxy");
    expect(await savedSelection()).toEqual(prior);await reloadApp(page);await assertOwner(otherProfile,other);
    for(const records of [Object.fromEntries(channels.map(channel=>[channel,[]])),{}]){
      await importValue({profiles:[profile],...records});await expect.poll(savedSelection).toEqual({profile,selectedLevels:{},...records});
      await reloadApp(page);await expect.poll(savedSelection).toEqual({profile,selectedLevels:{},...records});
      for(const heading of Object.values(headings))await expect(card.locator("details").filter({has:page.getByText(new RegExp("^"+heading+" \\("))})).toHaveCount(0);
    }
  }
  expect(errors).toEqual([]);assertNoExternalRequests(external);
});
}
