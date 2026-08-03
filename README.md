# Chronicle Android Raw Data Preprocessing App

A browser-based tool for preprocessing and visualizing [Chronicle](https://getmethodic.com/) Android screen-time data. Upload raw Chronicle CSV exports, configure preprocessing options, and download cleaned datasets and interactive timeline plots — all locally in the browser with no server or account required.

**[Launch the app](https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/)**

## What it does

- **Preprocesses** raw Chronicle app-usage and screen-usage exports into research-ready CSV files
- **Plots** interactive timelines of app usage, screen state, and activity heatmaps
- **Runs entirely in-browser** — your data never leaves your machine
- **Handles batches** — process hundreds of participant files in parallel
- **Compares configurations** — A/B comparison mode lets you test how different settings affect results
- **Works offline** — installable as a PWA, works without internet after first load

## Preprocessing features

- Filter apps using a custom filter file
- Configurable minimum usage duration threshold
- Customizable app engagement duration estimation
- Configurable thresholds for flagging long-running usage or data gaps
- Timezone removal and conversion
- Configurable interaction-type stop events and removal
- App categorization from codebook files
- Screen-gated usage crediting (opt-in) for research studies

## Getting started

Visit the [live app](https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/) — no installation needed. Or run locally:

```bash
cd web
npm install
npm run dev
```

## Development

```bash
make all     # full local CI: rust tests, web checks, e2e, security, deploy validation
make web     # typecheck + unit tests + contract check
make ci      # rust tests + security scanners
make help    # list all targets
```

The preprocessing engine is written in Rust, compiled to WebAssembly, and runs in web workers for parallel file processing. The web UI is React + Vite.

## Not affiliated with Chronicle

This is an independent research tool. Chronicle is made by [GetMethodic](https://getmethodic.com/).

## Credits

- [GetMethodic/Chronicle](https://github.com/methodic-labs/chronicle-processing) for their app and original preprocessing code
- Anil Kumar Vadathya, MS for writing our original custom preprocessing code ([GitHub](https://github.com/anilrgukt))
- Heidi Weeks, PhD ([Radesky Lab](https://radesky.lab.medicine.umich.edu/home)) for the original plotting code and app codebook
- Josh Culverhouse, PhD ([ACOI](https://sc.edu/study/colleges_schools/public_health/research/research_centers/acoi/)) for converting plotting code to Python, codebook contributions, and extensive testing
- Lindon Camaj, MS ([GitHub](https://github.com/lindoncamaj)) for app store scraping code used to obtain app categories
