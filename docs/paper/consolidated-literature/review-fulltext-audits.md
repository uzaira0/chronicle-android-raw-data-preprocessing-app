# Full-text audits of reviews, meta-analyses, surveys, and taxonomies

**Started:** 2026-08-29  
**Status:** living review-first evidence file; not a completed corpus

This file records review-level sources. A review is not treated as proof of what a cited primary
paper did. Its bibliography is a discovery set whose relevant primary papers must subsequently be
read. `Not reported` is used only after the complete accessible review was checked through its
references; unavailable searches, supplements, exports, and extraction forms are named explicitly.

Open access is an access route, not an eligibility criterion. The ledger contains 52 review source
records representing 51 canonical review works because R023 is the preprint version of published
R032. Publisher-licensed and library-licensed
main texts and supplements are included when legitimately available. Machine retrieval currently has
usable local full text for 39 of the 52 seeded review-level sources. Additional legitimate
author/library-repository recovery brings usable full-text coverage to 46/52. Six sources remain in the explicit institutional-access queue
[`non-open-access-review-queue.tsv`](./non-open-access-review-queue.tsv). An abstract or metadata page
never qualifies as a full-text audit.

Current review audit state is machine-readable in [`review-audit-status.jsonl`](./review-audit-status.jsonl):
33 complete through references and all linked artifacts, two complete with a specifically named
unavailable artifact, three partial because the main publication is inaccessible, 11 full texts retrieved
but not yet audited, and three not yet retrieved. These are workflow states, not quality ratings.

The machine-readable bibliography harvest currently contains 2,833 reference rows from 25 review
texts in [`review-reference-harvest.jsonl`](./review-reference-harvest.jsonl). These rows include
background, methods, review, and possibly excluded citations. They remain discovery records until
the review's included-study tables, figures, and supplements establish their role; they are not
reported as 2,833 included or unique primary papers.

The detailed audits of Pérez et al., Lee et al., Ryding and Kuss, and Parry et al. are already in
[`report-source.md`](./report-source.md). The records below add the other completed review audits and
preserve their search, screening, extraction, quality, synthesis, contradiction, and citation-harvest
evidence.

## Beynon et al. (2024) — quantitative measurement of child and adolescent screen use

- **Identity and access.** *Children* 11:754. DOI `10.3390/children11070754`. Complete
  PMC11275073 article and its 117 references checked; no supplement, code, or data artifact is
  linked.
- **Question and search.** Practical guidance for choosing quantitative naturalistic screen-use
  measures. PsycINFO, PubMed, Web of Science Core, CINAHL, SPORTDiscus, Embase, MEDLINE, Scopus,
  and IEEE were searched from 2010 onward, initially around young children. The authors report
  30,312 records after duplicates, but not the exact strings, dates, pre-deduplication count,
  duplicate procedure, or stage counts.
- **Selection, extraction, and quality.** Selection was explicitly iterative and purposive, adding
  four reviews, their references, and author-known methods. There was no bounded independent
  screening/adjudication process, formal extraction form, or risk-of-bias appraisal. The implicit
  fields are method mechanics, examples, constructs, and advantages/disadvantages.
- **Synthesis and construction relevance.** Author-derived narrative taxonomy: self/proxy report,
  observation, recording, onboard logging/screen recording, network/digital traces, proximity, and
  specialized devices. It does not systematically assess upstream preprocessing.
- **Citation harvest.** Direct construction seeds include Andrews 2015
  (`10.1371/journal.pone.0139004`), Radesky 2020 (`10.1542/peds.2019-3518`), Wade 2021
  (`10.2196/29426`), Gower and Moreno 2018 (`10.2196/11012`), Ram/Screenomics 2020
  (`10.1177/0743558419883362`), Boase and Ling 2013 (`10.1111/jcc4.12021`), Goedhart 2018
  (`10.1016/j.envres.2018.04.018`), Barr 2020 (`10.3389/fpsyg.2020.01283`), and Rich 2015
  (`10.1177/0002764215596558`).
- **Limitation.** The 30,312-record search is not a reproducible included-paper census because the
  final examples were purposively selected and no included-study ledger is supplied.

## Finnegan et al. (2024) — built-in behavioral biometrics on phones and tablets

- **Identity and access.** *Systematic Reviews* 13:31. DOI `10.1186/s13643-024-02451-1`;
  protocol OSF `10.17605/OSF.IO/92YCT`. Complete PMC10851515 article and all four supplements
  checked: appraisal framework, exact searches, 122-study matrix, and 122-study quality sheet.
- **Search.** Web of Science Core, Inspec/Engineering Village, Applied Science & Technology Source,
  IEEE Xplore, and PubMed. Database-specific strings are supplied. Searches ran September 14 and
  19, 2022 and covered 2007–2022. Counts reconstruct exactly: 22,537 raw; EndNote then Covidence
  duplicates removed to 14,179; 13,972 title/abstract exclusions; 207 sought; four unobtainable;
  203 assessed; 122 included.
- **Eligibility and screening.** English peer-reviewed human observed-data studies using built-in
  phone/tablet sensors for behavioral authentication or demographic detection; simulations,
  external equipment, and wearables excluded. The lead author and assistant calibrated jointly on
  600 records with 99.9% agreement, then divided the remainder. Full texts were assessed only by
  the lead author.
- **Extraction and quality.** The lead author extracted sample, demographics, method, stream,
  device/OS, outcome, setting, task freedom, and model performance; a second author reviewed every
  row. The lead author alone applied a 14-item adapted engineering/sensor framework. Mean quality
  was 5.5/14 (range 3–11); only 35/122 clearly described data handling and only 7/122 had methods
  judged replicable.
- **Synthesis and construction relevance.** Descriptive synthesis; heterogeneous metrics prevented
  meta-analysis. The appraisal detects whether handling is described, but it does not extract exact
  event-stream construction rules.
- **Citation harvest.** The seven behavior-profiling rows include Smith-Creasey and Rajarajan 2019
  (`10.1109/ICB45273.2019.8987390`), Deb 2019 (`10.1109/ICB45273.2019.8987433`), Mahbub 2016
  (`10.1109/BTAS.2016.7791155`), Acien 2019 (`10.1007/978-3-030-31321-0_2`), Phillips 2016
  (`10.1109/THS.2016.7568965`), Acien 2020 (`10.1109/COMPSAC48688.2020.00-81`), and Stylios 2022
  (`10.1108/ICS-12-2021-0212`). Other construction seeds include SilentSense, Murmuria, Nguyen,
  and the Chronicle feasibility paper (`10.2196/40572`).
- **Limitation.** Full-text screening and quality scoring were single-reviewer stages.

## Zhang et al. (2023) — passive social sensing with smartphones

- **Identity and access.** *Computing* 105:117–140. DOI `10.1007/s00607-022-01112-2`. Complete
  author/library PDF from the German National Library, including references, checked; no linked
  supplement found.
- **Question and search.** Passive smartphone social sensing: domains, sensors, collection,
  postcollection processing, validation, and challenges. ACM, IEEE, PubMed, Web of Science, and
  ScienceDirect; English peer-reviewed work from January 2000 through October 2020. The common
  smartphone × social × sensing query is printed, but execution dates and database translations are
  absent.
- **Screening.** 2,741 nonduplicates were screened to 47 included studies. Backward snowballing
  generated more than 2,000 citations, which were re-filtered. Database yields, duplicate method,
  stage counts, and exclusion counts are missing. Two authors independently made all inclusion
  decisions; six disagreements among the 47 included records were resolved by discussion. Calling
  this 12.8% a “probability of error” is not statistically justified.
- **Extraction and quality.** Implicit fields cover platform, sensor/OS/configuration, storage,
  ground truth, raw processing/features, analysis, performance, and challenges. Extraction
  independence is unreported and there is no formal quality appraisal.
- **Construction findings.** This review directly reports coarse upstream handling: 22/47 studies
  used remote-server storage, three local storage, and the rest did not report aggregation; six
  imposed data thresholds (two greater than 14 hours/day and four at least 19 hours/day); only one
  reported completeness (85.3%); and fixed/dynamic sampling rates were catalogued. It still does
  not recover event-level ordering, tie resolution, pairing, or boundary algorithms.
- **Citation harvest.** All 47 included studies are references 21–67, including StudentLife,
  CrossCheck, Funf, MONARCA, Schoedel 2020, and Stachl 2020.
- **Limitation.** No quality assessment and an incompletely reconstructable search/screening flow.

## Cornet and Holden (2018) — smartphone-based passive sensing for health and wellbeing

- **Identity and access.** *Journal of Biomedical Informatics* 90:3–16. DOI
  `10.1016/j.jbi.2017.12.008`. The complete accepted manuscript in PMC5793918, all references, and
  its appendix were read. No separate supplement was found.
- **Question and search.** Empirical passive smartphone sensing for health and wellbeing. ACM,
  MEDLINE, and Web of Science were searched through January 2017, followed by cited-reference
  searching. Table 1 reports exact concepts and counts: ACM 1,008→11; MEDLINE 1,366→14; Web of
  Science 1,318→10. Total 3,692; retained 35.
- **Eligibility.** English peer-reviewed empirical journal/conference work using phone-based passive
  or minimal-input sensing for health. Paired wearables, phones affixed as pure sensors, work after
  January 2017, and extended abstracts were excluded.
- **Deduplication and screening.** Duplicate count and method, stage-specific screening counts,
  reviewer number, independence, calibration, adjudication, and item-level decisions are not
  reported.
- **Extraction and quality.** The review reports population, purpose, sensors, outcomes, platform,
  and processing themes, but provides no extraction form or independence procedure. There is no
  formal risk-of-bias assessment; the authors say heterogeneity and the small literature precluded
  systematic quality evaluation.
- **Synthesis and construction relevance.** Narrative and tabular. Upstream event ordering,
  deduplication, pairing, timestamp, missing-event, and interval-construction disclosure were not
  assessed.
- **Citation harvest.** The 35 primary seeds are Osmani 2013; Grünerbl 2014 and 2015; Abdullah 2016;
  Beiwinkel 2016; Burns 2011; Canzian and Musolesi 2015; Saeb 2015 and 2016; Wahle 2016; Ben-Zeev
  2016; Difrancesco 2016; Wang 2016 schizophrenia; Ma 2014; Wang 2014 StudentLife; Ben-Zeev 2015;
  Asselbergs 2016; Huang 2016; Bai 2012; Natale 2012; Chen 2013; Abdullah 2014; Min 2014; Bhat 2015;
  Rabbi 2015a and 2015b; Eskes 2016; Kelly 2017; Lee 2014 addiction; Naughton 2016; Aranki 2016;
  Vathsangam 2014; Sanchez 2015; Stütz 2015; and Garcia-Ceja 2016.
- **Unresolved evidence.** No exported record set, deduplication ledger, screening decisions,
  extraction sheet, or quality ratings are available.

## Trifan, Oliveira, and Oliveira (2019) — passive sensing of health outcomes

- **Identity and access.** *JMIR mHealth and uHealth* 21(8):e12649. DOI `10.2196/12649`; protocol
  CRD4201912447. The complete PMC6729117 article and all 136 references were read. No supplement is
  linked.
- **Question and search.** Passive smartphone health/wellbeing outcomes, sensors, data, validation,
  and limitations. PubMed, IEEE Xplore, ACM DL, and Scopus. The generic printed query is
  `(smartphone OR mobile) AND (sensing OR monitoring) AND well-being AND (health OR mhealth)`.
  Main text says January 2014–March 2019; eligibility says through April 1, 2019.
- **Screening and contradiction.** 7,602 raw records; automatic title-only duplicate removal leaves
  7,404; title screen 1,339; abstract screen 199. The paper alternates between 118 and 119 included
  studies. Full-text exclusion reasons total 85, so 199−85=114—not either claimed total. Two first
  authors assessed records and bias and a third advised disagreements, but duplicate screening of
  every stage is unclear. Multiple versions using the same authors/method/app were reduced to the
  most recent or complete paper.
- **Extraction and quality.** A combined manual spreadsheet covered purpose, population, sample,
  duration, sensors/data, OS, validation/ground truth, limitations, privacy, and battery; it is not
  released. The authors claim Cochrane risk-of-bias assessment by two reviewers with third-party
  adjudication, but supply neither item ratings nor a justification for applying that instrument.
- **Synthesis and construction relevance.** Descriptive. Raw schema, timestamps, tie order,
  deduplication, pairing, gaps, and day-boundary disclosure were not assessed. Other numerical
  conflicts include accelerometer 67 in the abstract versus 35 in Table 5 and gyroscope 20 in prose
  versus 14 in the table.
- **Citation harvest.** References 1–3 and 6–120 give exactly 118 recoverable primary studies;
  references 4–5 are PRISMA/Cochrane and 121–136 are reviews/discussion. Nineteen studies reportedly
  use smartphone/app usage and seven use app usage, but those categories are not mapped to paper
  identities. All 118 remain candidates. Named high-priority lineages include StudentLife,
  CrossCheck, MONARCA, Bai/Min/Abdullah sleep work, Saeb, Canzian, Wang, Asselbergs, Stütz, and Lee.
- **Unresolved evidence.** Database-specific syntax/dates, record export, title-normalization code,
  decision log, extraction sheet, risk-of-bias ratings, and category-to-paper mapping are absent.

## Browne et al. (2021) — from screen time to the digital level of analysis

- **Identity and access.** *BMJ Open* 11:e046367. DOI `10.1136/bmjopen-2020-046367`; protocol DOI
  `10.1136/bmjopen-2019-032184`. The complete PMC8137212 article, 54 references, and five supplements
  were checked, including MEDLINE strategy, database/grey tables, flow, references, and review files.
- **Question and search.** Core digital-media concepts, tools, and gaps for ages 0–25. Ovid MEDLINE,
  PsycINFO, Scopus, and expert/organization grey searches; last search July 9, 2019. Publication
  boundary is inconsistently written as March 1 versus March 2, 2014 through March 1, 2019. The
  supplement gives the exact MEDLINE strategy; translated PsycINFO/Scopus strings are absent.
- **Screening.** Databases 6,459→4,274 after duplicates; Covidence removes 57 more→4,217;
  title/abstract excludes 4,069→148; full text excludes 22→126. Grey 28→25 after duplicates→14 after
  exclusion. Final: 140 sources and 162 tools. Two trained independent reviewers, expert/third-party
  resolution, IRR .81.
- **Extraction and quality.** Two independent Qualtrics extractors; 20-paper pilot IRR .68, revised
  to .81, third adjudication. Fields cover bibliographic/setting/paradigm/data, media/device/use/apps,
  sample/recruitment, and tool name/type/population/informant/reliability/validity. Two reviewers and
  a blinded third applied a four-domain appraisal: 74.48% low, 11% moderate, 14.48% high risk among
  database sources.
- **Synthesis and construction relevance.** Descriptive frequencies and thematic categories. Raw
  preprocessing disclosure was not assessed.
- **Citation harvest.** Four objective/device candidates appear in the supplement: Gower and Moreno
  2018 iPhone Battery screenshot (`10.2196/11012`); Alahmadi et al. 2015 RFID direct television time
  (`10.5220/0005611401450149`); Busschaert et al. 2015 automated passive component
  (`10.1186/s12966-015-0277-2`); Goedhart et al. 2018 XMobiSense (`10.1016/j.envres.2018.04.018`).
- **Unresolved evidence.** Translated searches and underlying extraction/screening data are not
  public; they are available only on reasonable request.

## Byrne, Terranova, and Trost (2021) — screen-time measurement in ages zero to six

- **Identity and access.** *Obesity Reviews* 22:e13260. DOI `10.1111/obr.13260`; protocol
  CRD42019132599. The complete PMC8365769 paper, 652 references, and supplementary search and
  psychometric tables were read.
- **Search and screening.** PubMed, Embase, PsycINFO; March 13, 2019 with April 30, 2020 update;
  January 2009 onward; English. Exact PubMed strategy supplied, translated strings absent. EndNote
  X9 and Covidence used. Two independent title/full reviewers with third resolution and
  backward/forward chaining. 35,868 unique records→1,035 full texts→622 included. Raw pre-dedup
  counts and detailed exclusion trail are not recoverable.
- **Extraction and quality.** One author extracted into Access; a second independently checked only
  49 papers. No formal quality appraisal. Synthesis is descriptive.
- **Central finding.** Zero of 622 papers used a device-based screen-time measure. This is strong
  evidence about prevalence, but it produces zero raw smartphone event-construction candidates.
- **Citation harvest.** Supplementary psychometric seeds: Bacardi-Gascon; Dawson-Hahn; Dwyer;
  Goncalves; Mendoza 2013 and 2016; Ogren; Cespedes; Eijkemans; Francis; Janz; Loprinzi 2013; Okely;
  Sarker; Schary; Thompson 2018; Wen; and Zimmerman, plus one overlapping row in the supplement's
  19-row validity set.
- **Unresolved evidence.** Translated searches, raw counts, extraction database, and item decisions
  are unavailable; dual extraction covered only 49 papers.

## Kaye et al. (2020) — conceptual and methodological mayhem of “screen time”

- **Identity and classification.** *International Journal of Environmental Research and Public
  Health* 17:3661. DOI `10.3390/ijerph17103661`. Complete PMC7277381 article and 57 references read.
  This is a critical conceptual article, not a systematic/scoping review.
- **Review-method fields.** Search dates, databases, search strings, deduplication, screening,
  eligibility counts, extraction, reviewer independence, adjudication, and quality assessment are
  structurally not applicable or not reported. It must not be presented as a bounded review corpus.
- **Contribution.** Critiques the undifferentiated “screen time” construct, self-report error,
  context, multi-screen behavior, and platform drift. It recommends objective logs while warning
  about device/user/context limitations and promotes affordance-based measures. It does not audit
  raw event processing.
- **Citation harvest.** Ernala et al., Facebook reporting; Andrews et al. 2015
  (`10.1371/journal.pone.0139004`); Ellis et al. 2019 (`10.1016/j.ijhcs.2019.05.004`); Sewall et al.
  2020 (`10.1177/2050157920902830`); Ellis 2019 critique (`10.1016/j.chb.2019.03.006`);
  Reeves/Robinson/Ram Human Screenome (`10.1038/d41586-020-00032-5`); Yeykelis et al. 2014
  (`10.1111/jcom.12070`); Wilcockson et al. 2019 (`10.1016/j.addbeh.2019.06.002`).

## D’Lima et al. (2022) — digital phenotyping using machine learning

- **Identity and access.** *JMIR Mental Health* 9:e39618. DOI `10.2196/39618`. Complete PMC11135220,
  75 references, PRISMA checklist, and the released 46-row XLSX extraction workbook were checked.
- **Question and search.** Digital-phenotyping studies, active/passive data, collection mode,
  analysis/ML, and future directions. PubMed and Google Scholar; final January 18, 2022; 2020–2022.
  A broad concept string is printed, but exact PubMed syntax and Google Scholar stopping depth are
  absent. No protocol.
- **Screening.** English original classification/prediction studies collecting wearable/mobile
  active/passive data. Reviews, meta-analyses, opinion, grey literature, protocols, genetics,
  non-English work, and feasibility-only work excluded. 454 after duplicates→80 full texts; 30
  ineligible and four unavailable→46. Raw/per-database counts and duplicate method absent. Two
  independent title/abstract reviewers; full texts randomly assigned with concordance discussions.
- **Extraction and quality.** Reviewers extracted title/author/year/country/design/clinical area,
  active/passive mode, analysis, and limitations; whether every record was independently duplicated
  is unclear. No quality appraisal.
- **Citation harvest.** Six direct phone/app-log seeds in the released workbook: Aubourg 2020
  call-detail records; Bai 2021 Mood Mirror call/text/app/GPS/screen; Di Matteo 2021 Android passive
  mic/GPS/screen/light; Henson 2021 mindLAMP+Beiwe screen time; Kim 2021 Noom engagement/app logs;
  Weingarden 2020 Perspectives iOS quantity/frequency/mobility.
- **Unresolved evidence.** Exact database syntax/depth, raw counts, deduplication method, item
  decisions, extraction independence, and risk-of-bias assessment.

## Dumas et al. (2026) — smartphone-only digital phenotyping across health conditions

- **Identity and access.** *Journal of Medical Internet Research* 28:e84146. DOI `10.2196/84146`.
  Complete PMC13013828, 120 references, exact-search DOCX, and PRISMA checklist checked.
- **Search.** Google Scholar, IEEE, ACM, PubMed; January 1, 2012–October 31, 2025; English. Exact
  platform-specific strings are supplied. Google Scholar was relevance sorted but stopping depth is
  absent. Backward searching was used; no registry or grey search.
- **Screening.** Roughly 3,700 records were manually saved and prefiltered to 111 formal records
  (PubMed 43, IEEE 21, ACM 26, Google Scholar 21). Two authors independently screened titles,
  abstracts, and full text; consensus, no kappa. Forty-six excluded→claimed 65. The unitemized
  3,700→111 prefilter prevents reconstruction, while the PRISMA figure misleadingly begins at 111.
- **Extraction and quality.** No data-charting method, form, fields, independence, or adjudication
  procedure appears, despite the PRISMA checklist pointing to paragraphs 7–10. Tables imply
  condition, phenotype, sensors, ground truth, sample, duration, focus, and setting. No quality or
  risk-of-bias appraisal.
- **Contradictions.** The 65 empirical rows are recoverable from Tables 3–7 as references 38–59,
  63–73, 75–92, 98–104, and 106–114; an earlier table-reading pass that found only 61 IDs was
  incomplete and is superseded. Table 2's caption says 19 prior reviews, the body says 21, and the
  table contains 18 prior-review rows plus the current review. Condition counts also conflict.
  Only 6/65 report missingness, 4/65 sampling/duty cycles, 22/65 operating system, and 7/65
  compliance. The review explicitly does not evaluate algorithms used to extract behaviors.
- **Citation harvest.** All 65 smartphone-only primary rows are identifiable. Priority disclosure
  seeds are Choudhary 2022 (`10.2196/37736`), Berrouiguet 2018 (`10.2196/mhealth.9472`), Wahle 2016
  (`10.2196/mhealth.5960`), MacLeod 2021 (`10.2196/20638`), Palmius 2016
  (`10.1109/TBME.2016.2611862`), Staples 2017 (`10.1038/s41537-017-0038-0`), StudentLife
  (`10.1145/2632048.2632054`), SmartGPA (`10.1145/2750858.2804251`), and Buck 2019
  (`10.1016/j.schres.2019.03.014`).
- **Unresolved evidence.** Record set, prefilter/deduplication log, extraction sheet, code, Google
  Scholar depth, quality appraisal, and extraction independence.

## Lee et al. (2023) — processing passive smartphone data into health-related markers

- **Identity and access.** *International Journal of Medical Informatics* 174:105061. DOI
  `10.1016/j.ijmedinf.2023.105061`. Complete author manuscript, references, and Elsevier feature
  glossary supplement checked.
- **Search and flow.** PubMed/MEDLINE, Scopus, Compendex, and HTA, with two librarians; April 2021,
  no date limit. Exact strings/yields total 3,170: 821, 1,891, 380, and 78. EndNote then Rayyan were
  used, but duplicate count/method is absent. The publication exposes only 3,170 raw→138 full
  texts→40 included, not the intermediate exclusions.
- **Eligibility and screening.** English peer-reviewed original research or proceedings collecting
  passive smartphone data; method-only, poster/abstract/protocol/review, nonphone, intervention,
  and app-development records excluded. Two reviewers independently screened title/abstract and
  full text; disagreement resolution is not reported.
- **Extraction and quality.** Citation/site, sample/duration, focus, measures, sensors/app,
  analytical methods, and findings. Extraction independence/checking is unreported. No quality
  appraisal, acknowledged as a limitation.
- **Construction relevance.** Organizes collection, feature extraction, analytics, behavioral
  markers, and outcomes; the supplement defines derived features such as location clusters and
  entropy. It does not audit record-level ordering, deduplication, or event-to-episode algorithms.
- **Citation harvest.** All 40 primary studies are Table 2/references 23–62. Device-use seeds include
  Henson 2021 (`10.2196/23144`), Gao 2016 (`10.7717/peerj.2197`), Saeb 2015
  (`10.2196/jmir.4273`), plus Messner, Rhim, Dissing, Abdullah, StudentLife, CrossCheck, Beiwe, and
  mindLAMP lineages.

## Choi, Ooi, and Lottridge (2024) — smartphone phenotyping for stress, anxiety, and mild depression

- **Identity and access.** *JMIR mHealth and uHealth* 12:e40689. DOI `10.2196/40689`. Complete
  PMC11157179 article, references, PRISMA checklist, and flow figure checked; no extraction or search
  data artifact is linked.
- **Search.** Web of Science, ACM, and PubMed. Common query: `digital phenotyping` or `passive
  sensing`, combined with stress, anxiety, or mild/moderate depression. September 2010–September
  2023, English; exact execution dates and database translations are absent.
- **Flow and screening.** 766 identified; five duplicates→761; 711 screened out→50 full reports;
  14 full-text exclusions→36 reports representing 40 studies. One author performed the initial
  screen and another reran searches for confirmation; this is not independent dual screening.
- **Extraction and quality.** Three authors independently extracted/confirmed aim, data, OS,
  behavioral pattern, surveys, sample, and model information; one later re-extracted predictive
  modeling. No formal quality appraisal.
- **Construction relevance.** Sensor, OS, model, and some technical challenges are recorded, but
  upstream event construction is not systematically assessed.
- **Citation harvest.** The 40 studies/36 reports are references 26–61 and Tables 1 and 3–6.
  Relevant candidates include Fukazawa, Di Matteo, Rhim, Acikmese, Rooksby, Chikersal, Morshed,
  Wang, Xu, Currey, and screen-use studies in the Henson lineage.
- **Reporting caution.** “40 studies” and “36 reports” are distinguishable because some reports
  contain multiple studies, but the article does not maintain that distinction consistently.

## Linardon et al. (2025) — raw sensors, processing pipelines, and behavioral features

- **Identity/status.** *Psychiatry Research* article DOI `10.1016/j.psychres.2025.116483`.
  **Partial, not full-text audited:** publisher text is paywalled and the Deakin repository file is
  embargoed; no accessible supplement, code, data, or codebook was found. It remains in the
  institutional-access queue.
- **Metadata-level evidence only.** PubMed reports 112 papers and a double-coded codebook covering
  sensors, extracted features, statistical methods, phone type/access, and population. Descriptive
  results include 67 Android, 38 Android+iPhone, mean duration 14.3 weeks, and GPS as the most common
  sensor. Databases, dates, strings, deduplication, screening, eligibility, reviewer process, quality
  appraisal, references, and the codebook remain unverified and are not inferred from the abstract.

## Beames et al. (2024) — phone-sensed behavior and youth depression/anxiety

- **Identity/artifacts.** DOI `10.1016/j.heliyon.2024.e35472`; protocol OSF `6h3a4`. Complete
  PMC11334877 article, references, PRISMA checklist, and Appendices A–E checked, including criteria,
  appraisal instrument, sampling/feature definitions, and ML tables.
- **Search/flow.** PubMed, PsycINFO, Embase, ACM, IEEE, Web of Science on November 2, 2021; English,
  post-2007. A complete PsycINFO example and concept blocks are supplied, not all six translations.
  Covidence: 6,946 raw−1,398 duplicates=5,548; 5,422 title/abstract exclusions→126 full texts;
  91 excluded→35 included.
- **Eligibility/screening.** Prospective passive phone sensing with depression/anxiety primary,
  validated measures and tested relationships, and at least 80% age 12–25/college. Wearable-only,
  self-report-only, other-condition, treatment, inaccessible, nonempirical, and qualitative work
  excluded. One author alone screened titles/abstracts; full text was independently screened twice,
  consensus with another author available, and study authors were contacted when needed.
- **Extraction/appraisal.** Six reviewers used a piloted Covidence form, with a consistency check;
  duplicate extraction/adjudication is unclear. Fields include site/design/dataset, sample/attrition,
  outcomes/timepoints, OS/app/duration, sensors/sampling, exact low-level definitions, high-level
  behaviors, analysis, results, and significance. QA-DPSS explicitly assesses sampling; replicable
  definition/extraction/processing; valid/missing data and robustness; dropout; protocol/analysis
  selection; and storage/privacy. Appraisal-reviewer independence is unreported. Results: 30/35 high,
  5/35 moderate, 0 low overall risk (excluding privacy/storage domain).
- **Construction relevance.** Strongest review located so far. Appendix D maps exact sampling and
  feature operationalization for location, accelerometer, gyroscope, steps, calls/SMS, microphone,
  light, screen/lock, Bluetooth, and apps, explicitly marking `NR`. It still does not itself reproduce
  every primary event algorithm.
- **Citation harvest.** All 35 primaries are supplement references 1–35, spanning StudentLife,
  LifeRhythm, Sensus, AWARE, SOLVD, PROSIT, mindLAMP, Moment, and QualityTime. Priority event seeds:
  Dissing 2021, Kim 2021 screen lock/unlock, Elhai 2018 objective use, Rozgonjuk 2018, Shoval 2020,
  Wang/StudentLife, Chikersal/AWARE, and Xu.
- **Cautions.** Single-reviewer first screen; shared datasets make studies nonindependent; Table 2
  sometimes inherits missing phone specifications from a dataset's primary paper rather than the
  cited analysis; only one database's executable string is supplied.

## Bidargaddi et al. (2024) — clinical validation of consumer remote sensing

- **Identity/artifacts.** DOI `10.1177/20552076241260414`. Complete PMC11282530 article,
  references, and both DOCX supplements checked.
- **Search/flow.** MEDLINE Ovid, PubMed, IEEE, ACM, Scopus, PsycINFO on December 3, 2019 and July 15,
  2022. PICO term blocks are reported, but database-specific executable strings are absent despite
  references to a detailed appendix; neither of the two actual supplements contains them. Covidence:
  15,751 raw−9,231 duplicates=6,520; 6,245 screen exclusions→275 full texts; 225 excluded by five
  reason categories→50 included.
- **Eligibility/methods.** Clinically diagnosed mental-health populations; phone app or wearable;
  validated reference measure; statistical sensor/reference relationship; sensor described; at
  least seven days; English peer-reviewed since 2009. Conference/protocol/lab/editorial/no-statistics
  records excluded. Three named screeners and three extractors, with two authors involved per stage,
  consensus and fourth-author resolution, but record-level independent duplication is unclear.
  Extraction covers demographics, diagnosis, reference type/mode, modality, clinical purpose,
  sampling interval, duration, timing design, and recruitment rationale. No formal quality appraisal.
- **Construction relevance.** Partial: Table 4 reports mean sample intervals—activity 81 seconds,
  sleep 86, location 486, within-phone interaction 143—plus duration and burden/quality tradeoffs.
  No deduplication, ordering, sessionization, or feature-construction rules are extracted.
- **Citation harvest.** All 50 included studies, references 13–62, are sensing candidates. Priority
  lineages: Ben-Zeev, Chikersal, Jacobson, SOLVD/Moukaddam, Saeb, Wahle, Barnett, Abdullah,
  Beiwinkel, Faurholt-Jepsen, Grünerbl, and Palmius.
- **Contradictions.** Title calls it systematic while abstract calls it scoping; detailed search
  appendix is missing/misnumbered; stated seven-day minimum conflicts with included three-day Averill
  and four-day McGowan studies in the supplement.

## Shen et al. (2025) — passive sensing and machine learning for mental-health monitoring

- **Identity/artifacts.** DOI `10.2196/77066`; protocol OSF `10.17605/OSF.IO/74ACP`. Complete
  PMC12395114 article and four appendices checked, including all seven searches, extraction tables,
  and the 42-study DOI-level matrix.
- **Search/eligibility.** Web of Science, PubMed, Scopus, Embase, IEEE, ACM, and PsycINFO; synchronized
  February 3, 2025, screening finished February 15; January 2015–February 2025. English journal
  research with at least 70% clinically diagnosed participants, naturalistic passive sensing, and
  ML. Conferences, prototypes, active questionnaire model inputs, lab/simulated studies, reviews,
  protocols, and unavailable/incomplete reports were excluded.
- **Flow.** 36,778 database records (5,641 WoS; 4,733 PubMed; 9,970 Scopus; 4,060 Embase; 3,050 IEEE;
  8,434 ACM; 890 PsycINFO); filters→27,004; 16,217 duplicates plus 914 incomplete records removed
  →9,873; 9,755 title/abstract exclusions→118; 13 citation records added→131 full texts; 89 excluded;
  42 included. Listed screening reasons total 8,355, leaving 1,400 unexplained; full-text reasons total
  88 rather than 89; abstract says 23 depression studies while Table 1 says 24.
- **Screening/extraction.** Two reviewers pilot-screened 30 then independently screened (κ=.91),
  discussion and third adjudicator. Two independent extractors used a standardized form covering
  study/sample/duration/funding, environment, device, sensor and placement, filtering/denoising and
  parameters, missingness, imbalance, sensor-specific processing, feature windows/overlap,
  time/frequency features, selection, ML, validation, performance, and eight behavioral domains.
- **Quality/synthesis.** No formal appraisal; PRISMA-ScR items 12 and 16 are `n/a`. Descriptive counts,
  medians/IQR, tables, networks, and heatmaps; no meta-analysis.
- **Construction relevance.** Unusually detailed for filtering, missingness, imbalance, windows, and
  features. “App usage” means activation/duration/frequency, including app-open intervals and screen-on
  time during use; “screen events” means on/off/lock/unlock counts and durations. These remain feature
  labels, not raw schema, same-timestamp order, deduplication, or session algorithms.
- **Seeds.** Direct phone candidates include `10.2196/19962`, `10.1145/3422821`,
  `10.1177/20552076241256730`, `10.1109/JBHI.2014.2343154`, `10.2196/56874`,
  `10.1016/j.brat.2021.104013`, `10.3390/s20123572`, `10.2196/16875`, `10.2196/45991`,
  `10.1016/j.jbi.2019.103371`, `10.3389/fpsyt.2020.584711`, `10.1016/j.smhl.2019.100093`,
  `10.1016/j.smhl.2022.100356`, `10.2196/24365`, and `10.2196/43719`.

## Machine learning for multimodal mental-health detection (2024)

- **Identity/access.** DOI `10.3390/s24020348`. Complete main text and embedded appendices checked;
  no external supplement or data artifact found.
- **Search/eligibility.** Scopus, PubMed, ACM, IEEE; 2015 onward; search date absent. Only a Scopus
  example is supplied, not translated searches. English peer-reviewed human passive-data articles
  using at least two modalities and ML for disorder detection; single-modality, under-10, symptom-only,
  dedicated-clinical-equipment, non-ML, and unpublished/nonarticle records excluded.
- **Flow contradiction.** 21,105 raw (16,793 Scopus; 2,804 ACM; 1,206 PubMed; 302 IEEE). The figure
  labels 11,602 as “duplicates removed,” but 11,602−10,467=1,135 eligibility records, so 11,602 must
  be the post-deduplication set and inferred duplicates are 9,503. Then 951 excluded→184 included.
- **Methods.** Reviewer independence/adjudication is unreported. Extraction covers disorder,
  collection, ground truth, feature extraction/transformation/fusion, ML, performance, and findings.
  A 12-item checklist assesses context, sample, controls, collection/data/features/ML, reliability,
  findings, limitations, and value; prose refers to nonexistent `QC13`.
- **Construction relevance.** Descriptive taxonomy, not meta-analysis; coarse feature processing only,
  with no cleaning, raw app/screen schema, order, deduplication, or episode construction audit.

## Straczkiewicz et al. (2021 revision) — smartphone human-activity recognition

- **Identity/access.** DOI `10.48550/arXiv.1910.03970`. Complete revised main text, references,
  tables, and figures checked; no separate supplement.
- **Search.** PubMed, Scopus, Web of Science on January 2, 2021 for work through December 31, 2020.
  Exact title/abstract/keyword query combines activity with recognition/estimation/classification and
  smartphone/cell/mobile phone. English full journal articles, smartphone-only consumer devices;
  auxiliary hardware, microphone/camera, multiple phones, and fixed body-mounted phones excluded.
- **Flow/problem.** 1,901 hits; reported exclusions are 793 no-HAR, 150 extra hardware, and 149
  microphone/camera/fixed-device, with 108 final. These numbers leave 701 records unexplained;
  duplicate and full-text counts are absent. Reviewer independence is unreported; no formal appraisal.
- **Extraction/relevance.** Sensor, setting, activities, placement, cleaning/repair, correction,
  filtering, orientation, trimming/windows, features, classifiers, validation, reproducibility, and
  generalizability. Useful for inertial processing but deliberately outside app/screen-event construction.
  Seeds include WISDM, UniMiB SHAR, SHL, MobiAct, Shoaib/SARD, Actitracker, ExtraSensory, Real World,
  Motion Sense, and HASC-2016. The 2019 arXiv identity must not obscure its 2021 search/revision.

## Melcher et al. (2021) — smartphone sensing for young-adult wellbeing

- **Identity/classification.** DOI `10.1109/ACCESS.2020.3045935`. Complete article/references checked;
  no supplement. It explicitly says it is not a systematic review.
- **Methods.** Google Scholar, PubMed, Scopus; 2010–2020, no search date; only example phrases, not
  executable strings. More than 400 records examined and 26 retained; duplicate/stage counts,
  reviewer independence, and adjudication absent. Eligible English work made passive phone sensing
  central, included young adults, n≥10, and retained repeated datasets only for new contributions.
  Authors contacted primary authors when unclear. No quality appraisal.
- **Extraction/relevance.** Domain, sample, duration, target population, person/behavior/environment,
  modality, self-report trigger, and analytic versus feedback system. Mentions continuous/interaction
  sensing, sampling, raw/inferred signals, transfer, app use, screen on/off, lock/unlock, touch, and
  typing but no construction algorithms. Seeds: MoodScope, Servia-Rodríguez, Murnane, DrinkSense,
  Do and Gatica-Perez, Bae, Sano, StudentLife, and BeWell+. Included count is 26, not 43.

## Cendrero-Luengo et al. (2026) — measuring smartphone use in people under 18

- **Identity/access.** English DOI `10.1016/j.anpede.2026.504156`; Spanish repository version
  `10.1016/j.anpedi.2026.504156`. Complete repository article and references checked; referenced
  electronic supplement remains unavailable.
- **Search/flow.** MEDLINE/PubMed, ScienceDirect, Google Scholar/grey; May 2014–May 2024; English,
  Spanish, French, Italian. Terms are reported but variations were chosen by yield, so the query is
  not reproducible. Figure: 321 database plus eight grey records→318 after 11 duplicates→172 screen
  exclusions→146 full text→57 excluded→89 included. Prose instead calls 321 the entire candidate set.
- **Screening/extraction.** Two independent reviewers at title/abstract, full text, and standardized
  extraction; all-reviewer consensus. Fields include population, design, instrument, validation,
  exact item/response/respondent, outcome, and measured phone time. No appraisal; planned meta-analysis
  abandoned for heterogeneity.
- **Relevance.** Primarily questionnaires. Only two installed background-monitoring apps are noted,
  without API, raw event, timestamp, ordering, deduplication, or interval construction. Objective seeds:
  Enthoven/Myopia App; Marin-Dragu (`10.1016/j.psychres.2023.115298`); Fortunato
  (`10.3390/ijerph20156439`).

## Screen Use Measurement Tools mapping review (2026)

- **Identity/classification.** DOI `10.1177/21522715261417288`. Complete article/references checked;
  no supplement. A targeted rapid review, explicitly not comprehensive or a psychometric meta-analysis.
- **Search/flow.** PubMed, PsycINFO, CINAHL through May 2024, no start limit. Iterative terms are
  reported without database syntax. 182 records; 115 duplicates and ten non-English removed→57;
  18 irrelevant→39 sought; three inaccessible→36 tools.
- **Methods.** Two reviewers screened with consensus, but independence is unclear. Three independent
  coders used a piloted framework and consensus; Fleiss κ/Gwet AC1, with AC1 .82–.98. Fields include
  tool, reliability, age, duration/construct focus, objective versus self/proxy, recall, valence,
  opportunity cost, and social context. Psychometric reliability is mapped, but no study-risk appraisal.
- **Relevance/caution.** Objective tools are classified by outputs, not raw construction. Seeds include
  MONARCA, LiveLab, Smartphone Addiction Management System, Smartphone Usage Tracker, iLog, Moment,
  App Usage Tracker, Callistics, iOS Screen Time, insightsapp, custom/unnamed Android apps, and LENA.
  “Google Play API” is ambiguous and may confuse distribution through Google Play with UsageStats.

## Schroeder, Francisco, and Barbosa (2026) — problematic technology use taxonomy

- **Identity/access.** DOI `10.1007/s40429-026-00759-7`. Complete Springer article, tables,
  Appendix A, and references checked; no external data/supplement.
- **Search/flow.** Ten databases/platforms searched August 8, 2025 for 2019–July 2025 English work;
  complete three-block phenotype/sensing × problematic/addiction × technology query and per-platform
  fields/filters are in Appendix A. 15,619 found→7,968 after filters→6,640 after Zotero duplicates
  →138 full texts after 6,502 exclusions→65 after ten inaccessible and 63 off-topic→52 after 13
  failed quality threshold.
- **Methods.** Conference/workshop/journal work included, contradicting the abstract's “peer-reviewed”
  wording. Independent screening/extraction is unreported. Inferred fields cover application stage,
  collection, domain, eight data classes, biomarkers, algorithms, validation, intervention, ethics,
  and barriers. Six yes/no quality items, scores below 3 excluded. Narrative four-taxonomy synthesis.
- **Relevance.** Logs include screen/app time, unlocks, notifications, communications, and system
  events, but raw APIs/schemas, same-time order, deduplication, and sessions are not extracted.
  High-yield seeds: `10.1145/3604241`, `10.1145/3610065`, `10.1145/3613904.3642747`,
  `10.1145/3491102.3517476`, `10.1145/3706598.3713724`, `10.2196/25019`, `10.2196/29426`,
  `10.2196/12171`, `10.1016/j.psychres.2023.115298`, `10.1007/s10578-022-01313-y`,
  `10.1007/s42979-022-01221-x`, `10.1016/j.chbr.2024.100569`, `10.1159/000540546`,
  `10.1155/2024/3601969`, `10.1038/s41598-022-05291-y`, `10.1057/s41599-021-00863-1`,
  `10.1038/s41746-025-01740-w`, `10.1155/2024/5860114`, `10.2196/27093`, and
  `10.24989/dp.v2i2.2002`.

## Fischer and Kleen (2021) — mobile apps in longitudinal epidemiology

- **Identity/access.** DOI `10.2196/17691`. Complete PMC7864774 article/references checked.
- **Search/flow.** PubMed through December 31, 2017; exact title/abstract app/smartphone/mHealth ×
  cohort/survey/questionnaire query; human, English/German. 1,922→114 after 1,808 title/abstract
  exclusions→17 after 97 full-text exclusions. Two independent reviewers; no formal appraisal.
- **Scope consequence.** Eligibility required participant-entered app data for more than one month.
  Automated passive GPS and phone-usage systems were explicitly excluded, so the 17-study synthesis
  supplies no included objective-event construction seeds.

## Kraft et al. (2024) — operationalizing mobile-crowdsensing sensor data

- **Identity/status.** DOI `10.1007/978-3-031-54531-3_13`. **Partial only:** publisher abstract and
  likely source master's thesis checked; the chapter and its exact references/supplements remain in
  the institutional-access queue and the thesis is not silently substituted for it.
- **Recoverable evidence.** Abstract confirms a PRISMA review with 661 screened and 117 included,
  covering application, goals, sensor use, time constraints, and processing device. The thesis used
  ACM, IEEE, and PubMed; `crowdsens*` in title/abstract plus `application OR app`; 2007 onward;
  641 database plus 31 manual→661 after duplicates→172 after title/abstract→117 included.
  It extracted goals, sensor use, quality assurance, timing, processing location, evaluation, and
  reporting. Search date, reviewer independence, adjudication, and appraisal are absent.
- **Relevance.** Mostly localization/environment/activity/generic crowdsensing. Quality assurance and
  processing location are relevant, but no app/screen schema, ordering, timestamp deduplication, or
  session audit is established from the inaccessible chapter.

## Abuhamad et al. (2021) — smartphone continuous authentication survey

- **Identity/classification.** DOI `10.1109/JIOT.2020.3020076`. Complete article/references checked;
  no supplement. Technical narrative survey, not systematic.
- **Methods.** No databases, dates, queries, deduplication, eligibility, screening, reviewer roles,
  adjudication, or appraisal. It claims more than 140 studies; modality totals 28 motion, 19 gait,
  20 keystroke, 29 touch, 16 voice, and 34 multimodal sum to 146 but overlap and are not unique.
- **Relevance.** Compares modality, sensors, algorithms, data, sample, performance, strengths, and
  challenges; discusses acquisition, noise/outlier/redundancy reduction, features, enrollment,
  verification, sampling, and windows, but not app/screen event construction. Direct seeds are Neal,
  Woodard and Striegel; Kayacik (`arXiv:1410.7743`); SenSec; and MineAuth. The 2020 arXiv revision
  versus 2021 IEEE publication is an identity/version distinction, not two papers.

## Harris et al. (2020) — problematic phone-use scales

- **Identity/artifacts.** DOI `10.3389/fpsyg.2020.00672`. Complete PMC7214716 article, three scale
  tables, Appendix A query, and references checked; no protocol, external supplement, code, or data.
- **Search/flow.** PsycINFO and MEDLINE Complete/EBSCOhost; prose says 1994–May 2019 while the exact
  executed query begins in 1990. Exact day and citation-chase stopping rule are absent. 2,452 hits
  −379 duplicates=2,073; 1,567 title exclusions→506; 40 abstract exclusions→466 articles examined;
  78 unique relevant scales. Dedup details and all reviewer roles are unreported.
- **Denominator problem.** Tables have 70 problematic-use, three frequency, and six motivation/
  attitude memberships=79, reconciled to 78 because MTUAS appears twice. The number and identities
  of included articles underlying the 78 instruments are never supplied.
- **Extraction/relevance.** Scale identity, items/format/range, validation sample/norms, reliability,
  validity, and construct; no extraction artifact or formal study appraisal. All retained measures
  are scales; zero objective logs. Andrews 2015 is background, not an included objective measure.

## Straczkiewicz, James, and Onnela (2021) — smartphone HAR methods

- **Identity/artifacts.** DOI `10.1038/s41746-021-00514-4`. Complete PMC8523707 XML, publisher PDF,
  matrix, and 143 references checked. Review data/scripts are available only on author request.
- **Search/flow.** PubMed, Scopus, Web of Science on January 2, 2021 through 2020; common exact
  activity × recognition/classification × smartphone query, but translated platform syntax absent.
  1,901 raw (251/716/934)−701 duplicates=1,200; 793 no HAR→407; 150 auxiliary hardware→257;
  149 mic/camera/body-fixed→108. Dedup and reviewer/extractor procedures are absent.
- **Extraction/relevance.** Environment, population/activity/location/sensor; repair, denoising,
  rotation, separation, normalization, segmentation; features/selection; classifier/platform;
  cross-location/cohort validation; public data/code. No appraisal. Directly useful for signal
  preprocessing, not app/screen event construction. Only 4/108 expose code and 15 public datasets.
- **Included set.** All 108 matrix-linked citations are reconstructed in
  [`review-r031-r038-included-primary-citations.tsv`](./review-r031-r038-included-primary-citations.tsv).

## Leaning et al. (2024) — digital phenotyping methods in depression

- **Identity/artifacts.** DOI `10.1016/j.neubiorev.2024.105541`; PROSPERO CRD42022346264; OSF
  `s7ay4`. Complete accepted manuscript and tables checked. OSF now returns 404, leaving exact-search,
  extraction-form, risk, and quality supplements inaccessible.
- **Search/flow.** PubMed, PsycINFO, Embase, Scopus, Web of Science; January 2012–November 10, 2023.
  6,369 database hits−3,178 duplicates=3,191; four title/abstract reason groups remove 3,086→105;
  five full-text groups remove 81→24. Two independent screeners and third adjudicator.
- **Extraction/appraisal.** Two reviewers extracted context/sample, goals, acquisition, paradigms,
  analysis, and appraisal factors. Adapted Cochrane risk assessment and adapted ML-quality appraisal
  were independent with adjudication, but ratings are trapped in unavailable supplements. Methods say
  five risk domains while enumerating six. Narrative comparison; no meta-analysis.
- **Included set/version.** Exact 24 Table-1 keys are in the TSV. The 2023 preprint's 14/3,249 and
  final article's 24/9,801 reflect a documented search update, not contradictory duplicate papers.

## Paudel et al. (2017) — correlates of mobile screen media use ages 0–8

- **Identity/artifacts.** DOI `10.1136/bmjopen-2016-014585`; protocol `10.1186/s13643-016-0272-y`;
  PROSPERO CRD42015028028. Complete article, protocol, reviewer files, draft, and references checked.
- **Search/flow.** Eight databases, September–October 2015 and March 2017, plus reference/Scholar
  author searches. Exact 25-line Ovid MEDLINE strategy; seven translations absent. 1,909 database+
  seven manual=1,916−376 duplicates=1,540; title−1,029=511; abstract−427=84; full−71=13.
  Duplicates manually removed in EndNote. Two title/abstract reviewers; all four at full text,
  consensus. Final extraction by one reviewer.
- **Quality/relevance.** Three independent modified Downs–Black appraisers; all 13 scored good
  (6–10, mean 7.85). Descriptive synthesis. Every included study uses parental self-report, so zero
  objective log-construction candidates. Exact 13 citations are in the TSV.

## Oatley et al. (2023) — mobile-phone data in crime applications

- **Identity/artifacts.** DOI `10.3390/s23094350`. Complete PMC10181620 article, taxonomy, tables,
  and 129 references checked; no protocol, supplement, export, code, or data.
- **Search.** Eight platforms, English 2014–2022, exact CDR/mobile-phone-data concept with platform
  adaptations; search date absent. Raw counts total 3,796. Excel and EndNote used, but duplicate
  matching is not reported. One reviewer conducted all phases; an unspecified test–retest by a second
  has no interval, sample, agreement, or adjudication details. No formal appraisal.
- **Irreconcilable flow.** Methods says 2,687 remained after duplicates/irrelevance and 107 after full
  text. Results says 2,687 were excluded and then 2,584 more excluded before 107 included. Neither
  arithmetic works. Seven of the claimed 107 “primary studies” are surveys, so the best defensible
  composition is 100 primaries+seven surveys; no one-row included appendix permits exact reconstruction.
- **Relevance.** CDR caller/callee, tower, timestamp, duration; stay points, home/work rules, spatial
  aggregation, and call networks. Useful adjacent event construction, not direct app-use logging.

## Stuijt et al. (2023) — passive smartphone sensing in cancer

- **Identity/artifacts.** DOI `10.1200/CCI.23.00141`; PROSPERO CRD42022352478. Complete
  PMC10703123 article/tables/references checked. Tailored-search supplement and PROSPERO content are
  blocked/unretrievable and remain explicit gaps.
- **Search/flow.** Six databases July 29, 2022, no date limit; four languages. 1,455 unique→97 full
  texts after 1,358 exclusions→12 reports after 85 exclusions; reference search adds a thirteenth
  report of an already included study, yielding 13 reports/12 studies. Raw and duplicate counts are
  absent. One title/abstract reviewer; two blinded Rayyan full-text reviewers. Extraction checking is
  ambiguous; no appraisal.
- **Relevance/set.** Objective, sensor, sample/cancer/duration narrative. Only two studies/three
  reports use analytics and none Apple devices. Low 2017 (`10.2196/jmir.9046`) is the direct seed.
  All 13 reports are in the TSV.

## Kittithaworn et al. (2024) — passive sensing for late-life depression

- **Identity/artifacts.** DOI `10.1371/journal.pone.0304845`; PROSPERO CRD42022341771. Complete
  PMC11210876 article and all five supplements checked, including 21-study tables and item-level JBI.
- **Search/flow.** PubMed, IEEE, PsycINFO, plus Scholar/reference search; 2012–September 2022. Concept
  blocks are tabled but platform syntax, dates/counts, Scholar depth, and dedup method are absent.
  3,711−570 duplicates=3,141; inferred 3,047 screen exclusions→94 sought; one unavailable→93;
  72 full exclusions→21. Four independent screeners, consensus/third resolution. Extraction
  duplication is unreported.
- **Quality/relevance.** Four independent design-specific JBI appraisers. Methods mistakenly says
  JBI assessed “the review,” while supplements apply primary-study tools. Evidence is called
  acceptable despite some cohort scores of 36.4% and 45.5%. Only three direct smartphone seeds:
  BiAffect (`10.1093/jamia/ocaa057`), Aubourg CDR (`10.1038/s41598-019-49723-8`), and Palmius GPS
  (`10.1109/TBME.2016.2611862`); most of the 21 are research wrist actigraphy. Exact set in TSV.

## Teh, Kempa-Liehr, and Wang (2020) — sensor data quality

- **Identity/scope.** DOI `10.1186/s40537-020-0285-1`. Complete 49-page article, HTML, tables, and
  106 references checked; no protocol, supplement, workbook, code, or data. It explicitly covers
  stationary wireless physical sensors and excludes mobile sensor networks and imaging.
- **Search/flow.** ACM, IEEE, ScienceDirect; September 27, 2018; no year limit. Exploratory query
  produced 13,057; LDA identified imaging and the final NOT-imaging query produced 6,970;
  −107 duplicates=6,863; −6,578 screen=285; −228 full text=57. BibTeX/Zotero; one reviewer only.
- **Quality/relevance.** Three custom validation/error-detection/error-correction items; 54/57 score
  at least 2, three score 1 and remain included. Unreleased Excel extraction; narrative plus Bayesian
  citation-rate analysis. Error types: outlier 32, missing 16, bias 12, drift 12, noise 8, constant 7,
  uncertainty 6, stuck-zero 6; methods include PCA, neural/ensemble/Bayesian/association approaches,
  tensor SVD, and filters. Exact 57 set is in the TSV, but direct app-event candidates are zero.
