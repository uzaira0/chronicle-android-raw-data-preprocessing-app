# Cross-slice deduplication register

**Last normalized:** 2026-08-06. This register removes duplicate *works* from corpus-level interpretation while preserving every slice-specific reason a work was found.

**Final mechanical audit:** 523 normalized DOI strings mentioned across A–F (the word
*resolvable* was dropped 2026-08-07 — no resolution test was run over this set, and the
extraction is known to capture publisher-URL fragments and one prose ellipsis as DOI
strings, so 523 is an upper bound on distinct DOIs); 26 DOI keys occur in more than one slice; four DOI-free exact-title clusters occur across slices. These are identifier-mention statistics, not a unique-paper census, because the ledgers also cite data/code artifacts and threshold ancestors. The non-resolving `10.5555/3235838.3235857` alias is not treated as a DOI.

## Normalization rules

1. DOI keys are lowercased, stripped of `https://doi.org/`, query strings, terminal punctuation, and presentation markup.
2. arXiv, OSF, SSRN, PubMed/PMC, report, software-repository, and standards identifiers are normalized to their stable accession when no publication DOI exists.
3. Titles are Unicode-normalized, case-folded, stripped of punctuation, and whitespace-collapsed. Exact normalized-title collisions are reviewed manually; titles alone never merge two different versions without author/year/source confirmation.
4. A preprint and its published version are one intellectual work when content/version metadata establish continuity; the published DOI is canonical and the preprint remains an access/version route.
5. A dataset, registration, software release, or protocol is a related artifact—not automatically a duplicate of the article. Artifact DOIs are attached to the canonical work rather than subtracted as if they were repeated articles.
6. A DOI that appears only in a threshold-inheritance note or cross-slice pointer is not counted as a second retained record.
7. Canonical home follows the paper’s principal methodological contribution, not the first slice that happened to find it.

## Canonical cross-slice work clusters

| Normalized identifier | Work | Seen in | Canonical home | Deduplication decision |
|---|---|---:|---:|---|
| `10.1007/978-3-031-08848-3_6` | De Weerdt & Wynn, *Foundations of Process Event Data* | C, E | C | One process-event foundation; E keeps an ontology pointer. |
| `10.1007/s41066-020-00226-2` | van Zelst et al., *Event Abstraction in Process Mining: Literature Review and Taxonomy* | C, E | C | One event-abstraction review; E keeps the representation relevance. |
| `10.1016/j.chb.2020.106616` | Hodes & Thomas, *Smartphone Screen Time: Inaccuracy of Self-Reports…* | B, F | F | Discrepancy study; B retains the Apple Screen Time instrument note. |
| `10.1016/j.chbr.2021.100164` | Kristensen et al., *Criterion Validity of a Research-Based Application for Tracking Screen Time…* | A, B | B | One cross-platform validation; B’s iOS/Android criterion comparison is the canonical record. |
| `10.1037/tmb0000022` | Shaw et al., *Quantifying Smartphone “Use”…* | A, B, D | D | Measurement-choice result; A/B keep instrument-lineage pointers. |
| `10.1038/s41386-020-0771-3` | Onnela, *Opportunities and Challenges in the Collection and Analysis of Digital Phenotyping Data* | D, F | D | General measurement/coverage framework, not a second discrepancy study. |
| `10.1038/s41598-021-94516-7` | Kiang et al., *Sociodemographic Characteristics of Missing Data in Digital Phenotyping* | D, F | D | Missingness/representation result; F keeps its mismatch implication. |
| `10.1080/1369118x.2025.2570738` | Asensio, Bosch & Roberts, *What Is the Best Way of Collecting Data Donations?* | B, F | B | Data-donation instrument experiment; F keeps omission/compliance relevance. |
| `10.1080/19312458.2023.2181319` | Welbers et al., *Digital Trace Data Collection for Social Media Effects Research* | B, F | F | One trace-collection methods paper; B retains the Screen Time route pointer. |
| `10.1080/19312458.2024.2393165` | *Unobtrusive Data Collection Can Introduce Biases: Tracking Undercoverage in Web Tracking Data* | D, F | D | Coverage-error evidence; retained as adjacent, not direct mobile session reconstruction. |
| `10.1145/1458082.1458176` | Jones & Klinkner, *Beyond the Session Timeout* | A, C | C | Search-session formalism; A mention is threshold/formalism inheritance only. |
| `10.1145/3706598.3713187` | Meinhardt et al., *Scrolling in the Deep* | A, D | A | Feature-level mobile-use construction; D retains the 15-minute selection/trigger implication. |
| `10.1145/3706598.3713638` | Okoshi et al., *Cyberoception* | A, F | A | Direct Android event-pairing method; F retains its logged-versus-subjective construction role. |
| `10.1145/3831979` | Meinhardt et al., *Can't Stop* | A, D | A | Feature-level scrolling-session implementation; D retains threshold-selection and open-validation relevance. |
| `10.1177/2050157917748351` | Zhu et al., *How to Measure Sessions of Mobile Phone Use?* | A, F | A | Direct mobile-session algorithm; F keeps discrepancy implications only. |
| `10.1177/2050157920959106` | Ohme et al., *Mobile Data Donations…with the iOS Screen Time Function* | B, F | F | Self-report/data-donation validation; B keeps the iOS instrument record. |
| `10.1177/20501579231193941` | Siebers, Beyens & Valkenburg, *The Effects of Fragmented and Sticky Smartphone Use…* | A, B | A | Direct threshold-sensitive mobile-use metric; B is a platform contrast pointer. |
| `10.1177/21522715261417288` | Shaleha et al., *Screen Use Measurement Tools: A Mapping of Instruments, Gaps, and Future Directions* | B, F | F | One measurement-tool map; B retains native-platform coverage. |
| `10.1371/journal.pone.0165331` | Christensen et al., *Direct Measurements of Smartphone Screen-Time…* | A, B | A | Early direct screen-state measurement; B is a historical iPhone-era pointer. |
| `10.1371/journal.pone.0338894` | Ochoa & Revilla, *Variability of a Job Search Indicator Induced by Operationalization Decisions…* | D, F | D | Multiverse/operationalization study; F’s use is construction-attribution context. |
| `10.2196/15417` | Tonti, Marzolini & Bulgheroni, *Smartphone-Based Passive Sensing…Technical Usability Study* | D, F | D | Technical coverage/usability evidence; F keeps the discrepancy mechanism. |
| `10.2196/42935` | Yang et al., *Association Between the Severity of Depressive Symptoms and Human-Smartphone Interactions* | A, D | A | Direct screen-session rule; D retains the within-/between-person sensitivity implication. |
| `10.31234/osf.io/bqfne_v3` | Toth et al., *Zooming in on Smartphone Habits* | D, F | D | One preprint comparing glance/session/episode units; F retains subjective automaticity comparison. |
| `10.31235/osf.io/xt24p_v3` | Toth, Parry & Klingelhoefer, *Somebody's (Still) Watching Me* | D, F | D | One measurement-reactivity preprint; F retains logged-ground-truth implications. |
| `10.3758/s13428-023-02252-9` | Reiter & Schoedel, *Never Miss a Beep* | D, F | D | Screen-conditioned ESM compliance study; F retains response-selection implications. |
| `10.1038/s41746-021-00514-4` + `10.48550/arxiv.1910.03970` | Straczkiewicz, James & Onnela, *Systematic review of smartphone-based human activity recognition* | review records R032, R023 | R032 | One intellectual review work and one 108-study corpus; published DOI canonical, arXiv retained as version/access route. |

## Related artifact collision—not a duplicate paper

| Identifier | Appears in | Resolution |
|---|---:|---|
| `10.17605/osf.io/sk4a5` | D, F | Shared OSF project/data artifact attached to its canonical article(s); it is not counted as an additional paper or subtracted as a duplicate publication. |

## Fresh-discovery canonical-home decisions

The second Pro pass returned 32 provisional imports. Exact normalized identifiers/titles were absent
from the earlier packet. Independent reconciliation assigns one canonical home to each retained work
and excludes the adjacent NAPsack record from direct-core counts.

| Stable key | Short work label | Canonical home | Decision |
|---|---|---:|---|
| `10.1145/3714394.3754395` | PULSE | A127 | Retain direct |
| `10.1145/3544548.3580689` | Are You Killing Time? | A128 | Retain direct |
| `10.1145/3522711` | Mobile Tasks | A129 | Retain direct |
| `10.1145/3479600` | Finesse / Reflect, Not Regret | A130 | Retain direct |
| `10.1145/3743726` | ODIM | A131 | Retain direct |
| `10.1145/3675094.3677547` | ScreenTK | A132 | Retain direct |
| `10.1145/3267305.3274118` | Notification Log | A133 | Retain direct |
| `10.3390/s24082612` | Call to Action | A134 | Retain direct |
| `10.1145/3770713` | Beyond the Feature Level | A135 | Retain direct, controlled-interface caveat |
| `10.1145/3447991` | Habitual Smartphone Use | A136 | Retain direct |
| `usenix-soups2014-harbach` | Hard Lock Life | A137 | Retain direct; replace non-resolving `10.5555` alias |
| `10.1145/3365610.3365611` | Annotif | A138 | Retain direct |
| `10.1145/3229434.3229445` | Dismissed! | A139 | Retain direct |
| `10.1145/2858036.2858566` | My Phone and Me | A140 | Retain direct |
| `10.1145/2858036.2858267` | Anatomy of Smartphone Unlocking | A141 | Retain direct |
| `10.1145/3613904.3642583` | Real-World Winds | A142 | Retain direct intervention trigger |
| `10.1145/3191754` | Meaningful or Meaningless? | A143 | Retain direct |
| `10.1145/3772318.3791137` | Crepe | A144 | Retain direct |
| `10.1145/3613904.3642347` | Smartphone Screen Text | A145 | Retain direct acquisition method |
| `10.1145/3728898` | Walls Have Ears | A146 | Retain direct source-semantics evidence |
| `10.1145/3473856.3473881` | Why Did You Stop? | A147 | Retain direct |
| `10.1145/3613904.3642832` | S-ADL | A148 | Retain controlled-fixture analogue |
| `10.3758/s13428-022-02006-z` | ScreenLife Capture | A149 | Retain direct collector |
| `10.48550/arxiv.2603.05923` | NAPsack / LongNAP | — | Adjacent only; exclude from direct corpus |
| `ios-unifiedlogs-unlock-2023` | Unified Logs unlock/app predicates | B91 | Retain labelled grey evidence |
| `ios-unifiedlogs-parser-sql-2025` | Unified Logs parser/SQL | B92 | Retain labelled executable grey artifact |
| `powerlogs-monotonic-clocks-2022` | PowerLogs timing | B93 | Retain labelled grey evidence |
| `10.1073/pnas.2213114120` | one sec | B94 | Retain direct intervention episode |
| `10.1145/3613904.3642370` | Longitudinal design frictions | B95 | Retain direct intervention episode |
| `10.1073/pnas.2427311122` | Winbush et al. | D104 | Retain direct construct audit |
| `10.1145/3678579` | Pin/sort/categorize notifications | D105 | Retain direct measurement/design audit |
| `10.1145/3532106.3533575` | MindPhone | F90 | Retain direct trigger/outcome-observability contrast |

## DOI-free exact-title collisions

| Normalized title | Seen in | Canonical home | Resolution |
|---|---:|---:|---|
| *Examining Measurement Discrepancies in Adolescent Screen Media Activity with Insights from the ABCD Study* | A, F | F | One discrepancy-focused work; A retains the passive-measurement pointer. |
| *Open-Source Smartphone App and Tools for Measuring, Quantifying, and Visualizing Technology Use* | A, F | A | One software/method paper; F retains its validation implication. |
| *Passive Sensing of Preteens’ Smartphone Use: An Adolescent Brain Cognitive Development (ABCD) Cohort Substudy* | A, F | A | One direct sensing substudy; F retains the self-report/log comparison context. |
| *Before You Scroll Again: Predicting Regretful Social Media Sessions From In-the-Wild Contextual and Wearable Sensing* | A, D, F | A | One arXiv preprint; D retains duration/selection sensitivity and F retains intention-versus-log construction. |

## Interpretation rule

Cross-slice presence is meaningful coverage, not evidence of multiple independent studies. The master review cites a canonical record once and then lists all relevant methodological roles. Detailed quotations remain in each slice so no evidence is destroyed by deduplication.
