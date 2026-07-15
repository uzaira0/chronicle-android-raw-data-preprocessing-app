import type { ReactElement } from "react";

import type { WorkflowTab } from "@/components/WorkflowNav";

type Props = {
  onNavigate: (tab: WorkflowTab) => void;
};

/**
 * Step-by-step manual of procedures (MOP) for study staff running the
 * preprocessor. Written for someone doing this for the first time: every step
 * says where to click and what "done" looks like. The tooltips on individual
 * settings explain WHAT a knob does; this page explains the PROCEDURE.
 */
export function GuidePanel({ onNavigate }: Props): ReactElement {
  return (
    <section className="guide" data-testid="guide-panel" aria-label="Step-by-step guide">
      <header className="guide__header">
        <div>
          <h2>Step-by-step guide</h2>
          <p className="guide__lede">
            How to preprocess one participant&rsquo;s raw Chronicle download, start to finish.
            Everything runs inside your browser — the data never leaves this computer.
          </p>
        </div>
        <button type="button" className="guide__print" onClick={() => window.print()}>
          Print this guide
        </button>
      </header>

      <ol className="guide-steps">
        <li>
          <h3>Get the raw file</h3>
          <p>
            You need the participant&rsquo;s <strong>raw Chronicle download</strong> — the CSV
            exactly as it was downloaded (a ZIP containing CSVs is also fine).
          </p>
          <p className="guide-warning">
            Do <strong>not</strong> open and re-save the file in Excel first, and do not rename or
            delete columns. Excel silently rewrites timestamps, which corrupts the file.
          </p>
        </li>
        <li>
          <h3>Load it</h3>
          <p>
            Open the{" "}
            <button type="button" className="guide-link" onClick={() => onNavigate("files")}>
              Files
            </button>{" "}
            tab and drop the file into the raw-data area (or click it to browse). You can load
            several participants&rsquo; files at once; each is processed separately.
          </p>
        </li>
        <li>
          <h3>Leave the settings alone</h3>
          <p>
            The defaults <em>are</em> the standard preprocessing: parse the events, normalize
            timezones, remove duplicate rows, rebuild screen sessions and app-usage episodes
            (with the study&rsquo;s locked matcher settings), and add categories and quality
            flags. If you have not been told to change a setting, don&rsquo;t.
          </p>
          <p>
            Cleaning and analysis steps — app filtering, zero-duration removal, screen-gated
            credit, study-window filtering, person attribution, compliance scoring — are{" "}
            <strong>off by default</strong>. Only turn one on if the study lead tells you to, and
            write down which ones you changed.
          </p>
        </li>
        <li>
          <h3>Process</h3>
          <p>
            Open the{" "}
            <button type="button" className="guide-link" onClick={() => onNavigate("process")}>
              Process
            </button>{" "}
            tab and press <strong>Process files</strong>. A progress list walks through the
            pipeline steps; large files can keep the browser busy for a while — leave the tab
            open.
          </p>
        </li>
        <li>
          <h3>Check the run</h3>
          <p>When it finishes, look at the summary before downloading anything:</p>
          <ul>
            <li>The row counts should be in a plausible range, not zero.</li>
            <li>
              The timezone line should name the zone you expect for this participant. A
              mixed-timezone prompt means the device changed zones — follow your protocol&rsquo;s
              rule for which handling to pick.
            </li>
            <li>Read every warning. If there is an error, see Troubleshooting below.</li>
          </ul>
        </li>
        <li>
          <h3>Download and store</h3>
          <p>
            Press <strong>Download all</strong> to get a ZIP with the app-usage table, the
            screen-usage table, and any plots or summaries that were enabled. Save it to your
            study&rsquo;s designated storage location under the participant&rsquo;s ID. Never
            email raw or processed files.
          </p>
        </li>
        <li>
          <h3>Log it</h3>
          <p>
            Record the run in your study&rsquo;s tracking sheet: participant ID, date, the raw
            file&rsquo;s name, and any setting you changed from the defaults (there should
            normally be none).
          </p>
        </li>
      </ol>

      <section className="guide-section">
        <h3>What the off-by-default steps do</h3>
        <p>
          These change the numbers in the output, so they are decisions for the study lead — not
          defaults. The{" "}
          <button type="button" className="guide-link" onClick={() => onNavigate("graph")}>
            Graph
          </button>{" "}
          tab shows where each step sits in the pipeline; click any step there to see exactly
          what depends on it.
        </p>
        <table className="guide-table">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">What it changes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>App filtering (filter file)</td>
              <td>Labels listed apps as &ldquo;filtered&rdquo; and blanks their timing.</td>
            </tr>
            <tr>
              <td>Zero-duration removal</td>
              <td>Drops sessions whose computed duration is zero or negative.</td>
            </tr>
            <tr>
              <td>Screen-gated credit</td>
              <td>Re-credits app time to only the minutes the screen was actually on.</td>
            </tr>
            <tr>
              <td>Study-window filtering</td>
              <td>Drops rows outside each participant&rsquo;s study dates.</td>
            </tr>
            <tr>
              <td>Person attribution</td>
              <td>Splits shared-device usage between household members.</td>
            </tr>
            <tr>
              <td>Compliance scoring</td>
              <td>Scores each participant-day against the study&rsquo;s threshold.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="guide-section">
        <h3>Troubleshooting</h3>
        <table className="guide-table">
          <thead>
            <tr>
              <th scope="col">Symptom</th>
              <th scope="col">What it usually means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>&ldquo;No valid app usage data during the study period&rdquo;</td>
              <td>
                The file is not a raw Chronicle export (wrong file picked), or it contains only
                screen events. Re-download the raw file and try again.
              </td>
            </tr>
            <tr>
              <td>Mixed-timezone prompt appears</td>
              <td>
                The device reported more than one timezone. Pick the handling your protocol
                specifies; when in doubt, ask the study lead before processing.
              </td>
            </tr>
            <tr>
              <td>Output has far fewer rows than expected</td>
              <td>
                The raw file may have been opened and re-saved in Excel, corrupting timestamps.
                Get a fresh copy of the original download.
              </td>
            </tr>
            <tr>
              <td>Short sessions have empty durations</td>
              <td>
                Expected: sessions under the minimum usage duration keep their row but have the
                duration blanked. This is part of the standard preprocessing.
              </td>
            </tr>
            <tr>
              <td>The browser tab becomes unresponsive on a big file</td>
              <td>
                Close other tabs and retry. If it keeps happening, process the CSVs from a ZIP a
                few at a time.
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>
  );
}
