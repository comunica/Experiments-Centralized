# Results of November 2026

Runs of the three experiments in November 2026, which are shown on https://comunica.dev/performance/:

| Directory | Experiment | Dataset | Triples |
|---|---|---|---|
| `watdiv-10` | WatDiv | scale 10 | 1.1M |
| `watdiv-100` | WatDiv | scale 100 | 11.0M |
| `watdiv-1000` | WatDiv | scale 1000 | 109.9M |
| `bsbm-1k` | BSBM | 1,000 products | 0.37M |
| `bsbm-10k` | BSBM | 10,000 products | 3.6M |
| `bsbm-100k` | BSBM | 100,000 products | 35.3M |
| `ldbc-snb-0.1` | LDBC SNB Interactive | SF 0.1 | 4.0M |
| `ldbc-snb-1` | LDBC SNB Interactive | SF 1 | 46.6M |

The engines are the combinations of each experiment: Comunica (`comunica-memory`, and `comunica-hdt` except in LDBC SNB), Oxigraph 0.5.13 (`oxigraph` on disk and `oxigraph-memory`), Jena Fuseki 6.2.0 (`jena` with TDB2 and `jena-memory`), Blazegraph 2.1.5, Virtuoso 7.2.17, GraphDB 10.8.14, and QLever (commit `afc421d`, except in BSBM).
Comunica ran from its development image, which will be released as v5.5.0.
LDBC SNB SF 1 ran with the image of [comunica/Experiments-Centralized#23](https://github.com/comunica/Experiments-Centralized/pull/23), as the images before it could not load that dataset.

Each engine ran in its own container, limited to one CPU core, on a machine with 128 GB of memory and a 24-core CPU.
Queries time out after 300 seconds.

## Files

Each directory has:

- `plot_small` and `plot_large` (WatDiv: C templates in `plot_large`; BSBM: query 5 in `plot_large`), or `plot_short` and `plot_complex` (LDBC SNB), as CSV, TeX and SVG files: the mean execution time of each query template, on a logarithmic axis. Query templates that an engine did not answer, through timeouts or errors, have no bar for that engine.
- `plot_load_times.csv`, `plot_load_times.svg` and `plot_load_times_store_size.svg`: the time each engine took to load the dataset, and the size of the loaded dataset in memory or on disk (see [Ingestion time and store size](../../README.md#ingestion-time-and-store-size)). For `comunica-hdt`, the loading time includes creating the HDT file and its index.

This directory also has:

- `report.html`: an interactive report of all runs, which also checks whether engines return the same result counts.
- `results.json`: the results as shown on comunica.dev.

The plots were made with `npm run plot` in each experiment, and the report and `results.json` with `scripts/report.js`.

QLever caches query results by default, so its repeated executions of a query can be faster than its first.
