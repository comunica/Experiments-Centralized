#!/usr/bin/env node
// Generates a self-contained interactive HTML report of experiment results, optionally across several dataset scales.
//
// Usage: node scripts/report.js [options] <input>...
//
// Each input is one of:
// - an experiment directory (containing jbr-combinations.json), such as experiments/watdiv;
// - a directory containing experiment directories, such as experiments;
// - a data file written earlier with --save-data, to combine runs at different scales.
// Append =<label> to an experiment directory to name its run, such as experiments/watdiv=WatDiv-small.
//
// Options:
//   --output <file>     HTML file to write (default report.html; not written when only --save-data is given)
//   --save-data <file>  Also write the collected results as JSON, to combine later with other runs
//   --title <text>      Page title (default "Experiment results")
//   --reference <name>  Combination name to compare every engine with (default comunica-memory)
//
// Runs of the same experiment at the same scale from later inputs replace earlier ones.
const fs = require('node:fs');
const path = require('node:path');

const LABELS = {
  'comunica-memory': 'Comunica-Memory',
  'comunica-hdt': 'Comunica-HDT',
  'oxigraph': 'Oxigraph',
  'oxigraph-memory': 'Oxigraph (in-memory)',
  'oxigraph-js': 'Oxigraph JS',
  'jena': 'Jena',
  'jena-memory': 'Jena (in-memory)',
  'blazegraph': 'Blazegraph',
  'virtuoso': 'Virtuoso',
  'graphdb': 'GraphDB',
  'qlever': 'QLever',
  'quadstore': 'Quadstore',
};
// Variants share the color of their family, drawn lighter.
const VARIANTS = { 'oxigraph-memory': 'oxigraph', 'jena-memory': 'jena' };
const EXPERIMENTS = {
  ExperimentWatDiv: { name: 'WatDiv', scale: c => c.datasetScale, scaleLabel: s => `scale ${s}` },
  ExperimentBsbm: { name: 'BSBM', scale: c => c.productCount, scaleLabel: s => `${Number(s).toLocaleString('en')} products` },
  ExperimentLdbcSnb: { name: 'LDBC SNB', scale: c => c.scale, scaleLabel: s => `SF ${s}` },
};
const INGESTION_MARKER = /JBR_INGESTION_TIME_S ([\d.]+)/u;

function parseArgs(argv) {
  const args = { inputs: [], output: undefined, saveData: undefined, title: 'Experiment results', reference: 'comunica-memory' };
  for (let i = 0; i < argv.length; i++) {
    const value = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`Missing value for ${argv[i]}`);
      }
      return argv[++i];
    };
    switch (argv[i]) {
      case '--output': case '-o': args.output = value(); break;
      case '--save-data': args.saveData = value(); break;
      case '--title': args.title = value(); break;
      case '--reference': args.reference = value(); break;
      case '--help': case '-h':
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1).filter((line, i, lines) => lines.slice(0, i + 1).every(l => l.startsWith('//')))
          .map(line => line.replace(/^\/\/ ?/u, '')).join('\n'));
        process.exit(0);
      default:
        if (argv[i].startsWith('-')) {
          throw new Error(`Unknown option ${argv[i]}`);
        }
        args.inputs.push(argv[i]);
    }
  }
  if (args.inputs.length === 0) {
    throw new Error('Usage: node scripts/report.js [--output report.html] [--save-data data.json] [--title text] [--reference comunica-memory] <experiment dir | data file>...');
  }
  if (!args.output && !args.saveData) {
    args.output = 'report.html';
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(line => line.length > 0);
}

// A query-times.csv from sparql-benchmark-runner: one row per query, with the time of every execution.
function readQueryTimes(file) {
  const [ header, ...rows ] = readLines(file);
  const columns = header.split(';');
  const templates = {};
  for (const row of rows) {
    const cells = Object.fromEntries(row.split(';').map((cell, i) => [ columns[i], cell ]));
    const template = templates[cells.name] ??= { times: [], queries: 0, failed: 0 };
    template.queries++;
    if (cells.error === 'true') {
      template.failed++;
    } else {
      template.times.push(...(cells.times || cells.time || '').split(' ').map(Number).filter(Number.isFinite));
    }
  }
  return Object.fromEntries(Object.entries(templates).map(([ name, t ]) => [ name, {
    mean: t.times.length > 0 ? t.times.reduce((a, b) => a + b, 0) / t.times.length : null,
    min: t.times.length > 0 ? Math.min(...t.times) : null,
    max: t.times.length > 0 ? Math.max(...t.times) : null,
    executions: t.times.length,
    queries: t.queries,
    failed: t.failed,
  } ]));
}

// A bsbm.xml from the BSBM driver: per query type, the geometric mean, fastest and slowest execution in seconds.
function readBsbm(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const templates = {};
  for (const [ , nr, body ] of xml.matchAll(/<query nr="(\d+)">([\s\S]*?)<\/query>/gu)) {
    const field = name => {
      const match = new RegExp(`<${name}>([^<]*)</${name}>`, 'u').exec(body);
      return match ? Number(match[1]) : null;
    };
    const executions = field('executecount');
    if (!executions) {
      continue;
    }
    templates[`Q${nr}`] = {
      mean: (field('aqetg') ?? field('aqet')) * 1000,
      min: field('minqet') * 1000,
      max: field('maxqet') * 1000,
      executions,
      queries: executions,
      failed: field('timeoutcount') ?? 0,
    };
  }
  return templates;
}

function readLoadTimes(logsDir) {
  const result = { startup: null, ingestion: null };
  if (!fs.existsSync(logsDir)) {
    return result;
  }
  const loadTime = path.join(logsDir, 'load-time.csv');
  if (fs.existsSync(loadTime)) {
    result.startup = Number(readLines(loadTime)[1]) / 1000;
  }
  // Comunica loads its data while starting (before its warm-up), so only engines that report ingestion get one.
  for (const file of fs.readdirSync(logsDir).filter(f => f.endsWith('.txt')).sort()) {
    const match = INGESTION_MARKER.exec(fs.readFileSync(path.join(logsDir, file), 'utf8'));
    if (match) {
      result.ingestion = Number(match[1]);
      break;
    }
  }
  return result;
}

function comunicaImage(combinationDir) {
  const dockerfiles = path.join(combinationDir, 'input', 'dockerfiles');
  const file = path.join(dockerfiles, 'Dockerfile-comunica-memory');
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return /^FROM\s+(\S+)/mu.exec(fs.readFileSync(file, 'utf8'))?.[1];
}

function collectExperiment(dir, label) {
  const combinations = readJson(path.join(dir, 'jbr-combinations.json')).combinations;
  let config;
  const engines = combinations.map((combination, i) => {
    const combinationDir = path.join(dir, 'combinations', `combination_${i}`);
    config ??= readJson(path.join(combinationDir, 'jbr-experiment.json'));
    const output = path.join(combinationDir, 'output');
    let templates;
    // BSBM's own report first, as a query-times.csv next to it may have been derived from it.
    if (fs.existsSync(path.join(output, 'bsbm.xml'))) {
      templates = readBsbm(path.join(output, 'bsbm.xml'));
    } else if (fs.existsSync(path.join(output, 'query-times.csv'))) {
      templates = readQueryTimes(path.join(output, 'query-times.csv'));
    }
    return {
      name: combination.name,
      label: LABELS[combination.name] ?? combination.name,
      family: VARIANTS[combination.name] ?? combination.name,
      templates: templates ?? null,
      ...readLoadTimes(path.join(output, 'logs')),
    };
  });
  const type = EXPERIMENTS[config['@type']] ?? { name: config['@type'], scale: () => undefined, scaleLabel: () => '' };
  const scale = type.scale(config);
  return {
    experiment: type.name,
    scale: scale === undefined ? null : String(scale),
    scaleLabel: scale === undefined ? '' : type.scaleLabel(scale),
    label: label ?? null,
    source: path.resolve(dir),
    collectedAt: new Date().toISOString(),
    comunicaImage: comunicaImage(path.join(dir, 'combinations', 'combination_0')) ?? null,
    params: Object.fromEntries(Object.entries(config)
      .filter(([ key, value ]) => !key.startsWith('@') && typeof value !== 'object' && !/url/iu.test(key))),
    engines,
  };
}

function collectInput(input) {
  const [ target, label ] = input.split(/=(.*)/su);
  if (fs.statSync(target).isFile()) {
    return readJson(target).runs;
  }
  if (fs.existsSync(path.join(target, 'jbr-combinations.json'))) {
    return [ collectExperiment(target, label) ];
  }
  const runs = fs.readdirSync(target)
    .filter(entry => fs.existsSync(path.join(target, entry, 'jbr-combinations.json')))
    .sort()
    .map(entry => collectExperiment(path.join(target, entry)));
  if (runs.length === 0) {
    throw new Error(`${target} contains no experiment (no jbr-combinations.json)`);
  }
  return runs;
}

function collect(inputs) {
  const runs = new Map();
  for (const run of inputs.flatMap(collectInput)) {
    const key = `${run.experiment}|${run.scale}|${run.label}`;
    if (runs.has(key)) {
      console.warn(`Replacing earlier results of ${run.experiment} ${run.scaleLabel} with those from ${run.source}`);
    }
    runs.set(key, run);
  }
  return [ ...runs.values() ];
}

function toHtml(data) {
  // Escape "<" so the data can never close its script element.
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const title = data.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  return TEMPLATE
    .replace('%TITLE%', () => title)
    .replace('%DATA%', () => json);
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%TITLE%</title>
<style>
  :root {
    --bg: #fbfbfa; --panel: #ffffff; --fg: #1d2129; --muted: #5d6573; --line: #e3e5e8; --grid: #eceef1; --axis: #b7bcc4;
    --accent: #2457c5; --bad: #c2362b; --ok: #237a4b; --warn: #a86400; --tip: #ffffff; --shadow: 0 4px 16px rgb(20 30 50 / 0.12);
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #15181d; --panel: #1c2027; --fg: #e6e8eb; --muted: #9aa3b0; --line: #2c323b; --grid: #262b33; --axis: #4a525e;
      --accent: #7aa2ff; --bad: #ff7b6e; --ok: #5fcf8f; --warn: #f0b04f; --tip: #232832; --shadow: 0 4px 16px rgb(0 0 0 / 0.5);
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 var(--sans); }
  .page { max-width: 82rem; margin-inline: auto; padding: 2rem max(16px, env(safe-area-inset-right)) 4rem max(16px, env(safe-area-inset-left)); display: grid; gap: 1.75rem; }
  h1 { font: 400 2rem/1.2 var(--serif); margin: 0; text-wrap: balance; }
  h2 { font: 400 1.5rem/1.25 var(--serif); margin: 0; }
  h3 { font-size: 1rem; font-weight: 600; margin: 0; }
  p { margin: 0; }
  .muted, .note { color: var(--muted); }
  .note { font-size: 0.85rem; max-width: 80ch; }
  .lede { max-width: 70ch; display: grid; gap: 0.35rem; }
  .lede b { font-variant-numeric: tabular-nums; }
  .tabs, .scales { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .tabs button, .scales button, .legend button {
    font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 0.3rem 0.9rem; cursor: pointer;
  }
  .tabs button[aria-pressed="true"], .scales button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem; display: grid; gap: 0.75rem; min-width: 0; }
  .page > * { min-width: 0; }
  .experiment { display: grid; gap: 1.25rem; min-width: 0; }
  .run-head { display: grid; gap: 0.5rem; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .legend button { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; padding: 0.15rem 0.7rem; }
  .legend button[aria-pressed="false"] { opacity: 0.45; text-decoration: line-through; }
  .sw { width: 0.7rem; height: 0.7rem; border-radius: 2px; display: inline-block; flex: none; }
  .scroll { overflow-x: auto; min-width: 0; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
  th { font-size: 0.8rem; font-weight: 600; color: var(--muted); vertical-align: bottom; }
  th button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: inherit; }
  th[aria-sort] button::after { content: " \\2195"; opacity: 0.4; }
  th[aria-sort="ascending"] button::after { content: " \\2191"; opacity: 1; }
  th[aria-sort="descending"] button::after { content: " \\2193"; opacity: 1; }
  th:first-child, td:first-child { text-align: left; }
  td:first-child .sw { margin-right: 0.45rem; }
  tr.reference td { font-weight: 600; }
  tr.missing td { color: var(--muted); }
  .chart { position: relative; overflow-x: auto; }
  .chart-inner { position: relative; }
  .chart svg { display: block; }
  .chart text { fill: var(--muted); font-size: 12px; font-family: var(--sans); }
  .tip { position: absolute; top: 0; left: 0; pointer-events: none; background: var(--tip); border: 1px solid var(--line); border-radius: 8px;
    box-shadow: var(--shadow); padding: 0.4rem 0.6rem; font-size: 0.8rem; display: grid; gap: 2px; min-width: 14rem; z-index: 2; }
  .tip[hidden] { display: none; }
  .tip .head { color: var(--muted); margin-bottom: 2px; }
  .tip .row { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: center; font-variant-numeric: tabular-nums; }
  .tip .row span:last-child { text-align: right; }
  .status { display: grid; gap: 0.25rem; font-size: 0.9rem; }
  details summary { cursor: pointer; font-weight: 600; }
  dl { display: grid; grid-template-columns: minmax(9rem, max-content) 1fr; gap: 0.5rem 1rem; margin: 1rem 0 0; max-width: 90ch; }
  dt { font-weight: 600; }
  dd { margin: 0; color: var(--muted); }
  @media (max-width: 40rem) { dl { grid-template-columns: 1fr; } h1 { font-size: 1.6rem; } }
</style>
</head>
<body>
<main class="page">
  <header class="lede">
    <h1 id="title"></h1>
    <p class="muted" id="generated"></p>
    <div id="summary" class="lede"></div>
  </header>
  <nav class="tabs" id="tabs" aria-label="Experiments"></nav>
  <section id="experiment" class="experiment"></section>
  <details>
    <summary>How to read this report</summary>
    <dl>
      <dt>Template time</dt>
      <dd>For WatDiv and LDBC SNB, the mean over all executions of a template's queries (every query runs several times after a warm-up round). For BSBM, the driver's geometric mean per query type. Whiskers span the fastest and slowest execution.</dd>
      <dt>Geometric mean</dt>
      <dd>The geometric mean of the template times over the templates that every engine of that run answered without a failure, so all engines are compared on the same templates. Sum of means uses the same templates.</dd>
      <dt id="reference-term"></dt>
      <dd>The geometric mean of the per-template ratios to the reference engine, over the templates both engines answered (Shared). Below 1 means faster than the reference. This stays meaningful when engines fail on different templates.</dd>
      <dt>Failed</dt>
      <dd>Queries that returned an error or timed out (BSBM: timeouts reported by its driver).</dd>
      <dt>Startup and ingestion</dt>
      <dd>Startup is the time from starting an endpoint until it answers, including loading the data. Ingestion is the loading time an engine reports itself; Comunica loads its data during startup.</dd>
      <dt>Scaling</dt>
      <dd>When an experiment has runs at several scales, the scaling chart shows each engine's ratio to the reference per scale. The templates every engine answered can differ per scale.</dd>
    </dl>
  </details>
</main>
<script type="application/json" id="data">%DATA%</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('data').textContent);
  const SVG = 'http://www.w3.org/2000/svg';
  // Ten categorical colors that read on light and dark backgrounds.
  const PALETTE = ['#3b6fd8', '#d4762a', '#3a9d5d', '#c2453d', '#8a5cc7', '#2d9fa6', '#b5548c', '#7a8a2a', '#5f6b7a', '#c49a1a'];
  const families = [];
  for (const run of data.runs) for (const e of run.engines) if (!families.includes(e.family)) families.push(e.family);
  const isVariant = (e) => e.family !== e.name;
  // A variant is its family's color mixed with white, which stays visible on both themes.
  const tint = (hex) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.55 + 255 * 0.45).toString(16).padStart(2, '0')).join('');
  const colorOf = (e) => {
    const base = PALETTE[families.indexOf(e.family) % PALETTE.length];
    return isVariant(e) ? tint(base) : base;
  };
  const nf = (digits) => new Intl.NumberFormat('en', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const ms = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v < 10 ? nf(2).format(v) : v < 100 ? nf(1).format(v) : nf(0).format(v));
  const ratio = (v) => (v === null || !Number.isFinite(v) ? '' : v < 10 ? nf(2).format(v) : nf(1).format(v)) + (v === null ? '' : '\\u00d7');
  const secs = (v) => (v === null || v === undefined ? '' : nf(1).format(v));
  const shortName = (t) => t.replace(/^interactive-complex-(\\d+)$/, 'IC$1').replace(/^interactive-short-(\\d+)$/, 'IS$1');
  const collator = new Intl.Collator('en', { numeric: true });
  const node = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    el.append(...children);
    return el;
  };
  const svgNode = (tag, attrs, parent) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.append(el);
    return el;
  };
  const swatch = (e) => node('span', { class: 'sw', style: 'background:' + colorOf(e) });

  // Summary metrics of one run.
  function analyze(run) {
    const ok = (e, t) => e.templates && e.templates[t] && e.templates[t].mean !== null && e.templates[t].failed === 0;
    const withData = run.engines.filter((e) => e.templates);
    const templates = [...new Set(withData.flatMap((e) => Object.keys(e.templates)))].sort(collator.compare);
    const common = templates.filter((t) => withData.every((e) => ok(e, t)));
    const reference = run.engines.find((e) => e.name === data.reference && e.templates);
    const rows = run.engines.map((e) => {
      if (!e.templates) return { engine: e, missing: true };
      const values = common.map((t) => Math.max(e.templates[t].mean, 0.01));
      const shared = reference ? templates.filter((t) => ok(e, t) && ok(reference, t)) : [];
      const all = Object.values(e.templates);
      return {
        engine: e,
        answered: templates.filter((t) => ok(e, t)).length,
        failed: all.reduce((s, t) => s + t.failed, 0),
        queries: all.reduce((s, t) => s + t.queries, 0),
        geomean: values.length ? Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length) : null,
        sum: values.length ? values.reduce((s, v) => s + v, 0) : null,
        relative: shared.length ? Math.exp(shared.reduce((s, t) => s + Math.log(Math.max(e.templates[t].mean, 0.01) / Math.max(reference.templates[t].mean, 0.01)), 0) / shared.length) : null,
        shared: shared.length,
        startup: e.startup,
        ingestion: e.ingestion,
      };
    });
    return { templates, common, rows, reference };
  }

  const ORDER = ['WatDiv', 'BSBM', 'LDBC SNB'];
  const rank = (exp) => (ORDER.includes(exp) ? ORDER.indexOf(exp) : ORDER.length);
  const experiments = [...new Set(data.runs.map((r) => r.experiment))].sort((a, b) => rank(a) - rank(b) || collator.compare(a, b));
  const runsOf = (exp) => data.runs.filter((r) => r.experiment === exp)
    .sort((a, b) => collator.compare(a.scale ?? '', b.scale ?? '') || collator.compare(a.label ?? '', b.label ?? ''));
  const runName = (r) => r.label || r.scaleLabel || 'default';
  const refLabel = (data.runs.flatMap((r) => r.engines).find((e) => e.name === data.reference) || { label: data.reference }).label;

  document.getElementById('title').textContent = data.title;
  document.title = data.title;
  document.getElementById('generated').textContent = 'Generated ' + new Date(data.generatedAt).toLocaleString('en') + ' from ' + data.runs.length + ' run' + (data.runs.length === 1 ? '' : 's') + '.';
  document.getElementById('reference-term').textContent = 'vs ' + refLabel;

  // One line per experiment: where the reference stands.
  const summary = document.getElementById('summary');
  for (const exp of experiments) {
    for (const run of runsOf(exp)) {
      const { rows, common } = analyze(run);
      const ranked = rows.filter((r) => !r.missing && r.geomean !== null).sort((a, b) => a.geomean - b.geomean);
      if (!ranked.length) continue;
      const ref = ranked.findIndex((r) => r.engine.name === data.reference);
      const text = 'Fastest: ' + ranked[0].engine.label + ', ' + ms(ranked[0].geomean) + ' ms.' +
        (ref > 0 ? ' ' + refLabel + ': rank ' + (ref + 1) + ' of ' + ranked.length + ', ' + ms(ranked[ref].geomean) + ' ms.' : '') +
        ' Geometric mean over ' + common.length + ' templates.';
      summary.append(node('p', {}, node('b', { text: exp + (run.scaleLabel || run.label ? ', ' + runName(run) : '') + '. ' }), text));
    }
  }

  const state = { experiment: experiments[0], run: {}, hidden: new Set() };
  const tabs = document.getElementById('tabs');
  const section = document.getElementById('experiment');

  function renderTabs() {
    tabs.replaceChildren(...experiments.map((exp) => node('button', {
      type: 'button', 'aria-pressed': String(exp === state.experiment), text: exp,
      onclick: () => { state.experiment = exp; renderTabs(); render(); },
    })));
  }

  function render() {
    const runs = runsOf(state.experiment);
    const run = runs.find((r) => runName(r) === state.run[state.experiment]) || runs[runs.length - 1];
    state.run[state.experiment] = runName(run);
    const analysis = analyze(run);
    const head = node('div', { class: 'run-head' }, node('h2', { text: state.experiment + (run.scaleLabel ? ', ' + run.scaleLabel : '') }));
    if (runs.length > 1) {
      head.append(node('div', { class: 'scales', role: 'group', 'aria-label': 'Scale' }, ...runs.map((r) => node('button', {
        type: 'button', 'aria-pressed': String(r === run), text: runName(r),
        onclick: () => { state.run[state.experiment] = runName(r); render(); },
      }))));
    }
    const p = run.params;
    const facts = [];
    if (p.queryCount) facts.push(p.queryCount + ' queries per template');
    if (p.queryRunnerReplication) facts.push(p.queryRunnerReplication + ' executions per query after ' + (p.queryRunnerWarmupRounds ?? 0) + ' warm-up round' + (p.queryRunnerWarmupRounds === 1 ? '' : 's'));
    if (p.runs) facts.push(p.runs + ' query mixes after ' + (p.warmupRuns ?? 0) + ' warm-up mixes');
    if (run.comunicaImage) facts.push('Comunica image ' + run.comunicaImage.replace(/@sha256:([0-9a-f]{12})[0-9a-f]+/, '@sha256:$1\u2026'));
    head.append(node('p', { class: 'note', text: facts.join(' \u00b7 ') }));
    section.replaceChildren(head, engineCard(run, analysis), templateCard(run, analysis));
    const scaling = scalingCard(runs);
    if (scaling) section.append(scaling);
  }

  function engineCard(run, analysis) {
    const columns = [
      ['Engine', (r) => r.engine.label, (r) => r.engine.label],
      ['Geomean (ms)', (r) => ms(r.geomean), (r) => r.geomean],
      ['vs ' + refLabel, (r) => (r.relative === null ? '' : ratio(r.relative)), (r) => r.relative],
      ['Shared', (r) => String(r.shared ?? ''), (r) => r.shared],
      ['Sum of means (ms)', (r) => ms(r.sum), (r) => r.sum],
      ['Answered', (r) => (r.missing ? '' : r.answered + ' / ' + analysis.templates.length), (r) => r.answered],
      ['Failed', (r) => (r.missing ? '' : r.failed + ' / ' + r.queries), (r) => r.failed],
      ['Startup (s)', (r) => secs(r.startup), (r) => r.startup],
      ['Ingestion (s)', (r) => secs(r.ingestion), (r) => r.ingestion],
    ];
    let sort = { index: null, dir: 1 };
    const table = node('table');
    const draw = () => {
      let rows = analysis.rows.slice();
      if (sort.index !== null) {
        const key = columns[sort.index][2];
        rows.sort((a, b) => {
          const x = key(a), y = key(b);
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (typeof x === 'string' ? collator.compare(x, y) : x - y) * sort.dir;
        });
      }
      const headRow = node('tr', {}, ...columns.map(([label], i) => {
        const th = node('th', { 'aria-sort': sort.index === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none' },
          node('button', { type: 'button', text: label, onclick: () => { sort = { index: i, dir: sort.index === i ? -sort.dir : 1 }; draw(); } }));
        return th;
      }));
      const body = rows.map((r) => {
        const tr = node('tr', { class: (r.engine.name === data.reference ? 'reference' : '') + (r.missing ? ' missing' : '') });
        columns.forEach(([, fmt], i) => {
          const td = node('td', { text: r.missing && i > 0 ? (i === 1 ? 'no results' : '') : fmt(r) });
          if (i === 0) td.prepend(swatch(r.engine));
          tr.append(td);
        });
        return tr;
      });
      table.replaceChildren(node('thead', {}, headRow), node('tbody', {}, ...body));
    };
    draw();
    return node('div', { class: 'card' },
      node('h3', { text: 'Engines' }),
      node('p', { class: 'note', text: 'Geometric mean over the ' + analysis.common.length + ' of ' + analysis.templates.length + ' templates that every engine answered without a failure. Click a column to sort.' }),
      node('div', { class: 'scroll' }, table));
  }

  function templateCard(run, analysis) {
    const engines = run.engines.filter((e) => e.templates);
    const legend = node('div', { class: 'legend', role: 'group', 'aria-label': 'Engines shown' }, ...engines.map((e) => node('button', {
      type: 'button', 'aria-pressed': String(!state.hidden.has(e.name)),
      onclick: (ev) => { state.hidden.has(e.name) ? state.hidden.delete(e.name) : state.hidden.add(e.name); ev.currentTarget.setAttribute('aria-pressed', String(!state.hidden.has(e.name))); drawChart(); },
    }, swatch(e), e.label)));
    const chart = node('div', { class: 'chart' });
    const drawChart = () => templateChart(chart, engines.filter((e) => !state.hidden.has(e.name)), analysis.templates);
    const card = node('div', { class: 'card' },
      node('h3', { text: 'Per template' }),
      node('p', { class: 'note', text: 'Template time on a log scale, with whiskers from the fastest to the slowest execution and a red mark where queries failed. Hover or tap a template for its values; click an engine to hide it.' }),
      legend, chart);
    requestAnimationFrame(drawChart);
    new ResizeObserver(() => drawChart()).observe(chart);
    return card;
  }

  function logScale(lo, hi, top, bottom) {
    const a = Math.log10(lo), b = Math.log10(hi);
    return (v) => bottom - (Math.log10(Math.max(v, lo)) - a) / (b - a) * (bottom - top);
  }

  function drawYAxis(svg, lo, hi, y, left, right) {
    const ticks = [];
    for (let p = Math.round(Math.log10(lo)); p <= Math.round(Math.log10(hi)); p++) ticks.push(10 ** p);
    const labels = ticks.map((v) => {
      svgNode('line', { x1: left, x2: right, y1: y(v), y2: y(v), stroke: 'var(--grid)' }, svg);
      const t = svgNode('text', { x: left - 6, y: y(v), dy: '0.32em', 'text-anchor': 'end' }, svg);
      t.textContent = v >= 1 ? v.toLocaleString('en') : String(v);
      return t;
    });
    return labels;
  }

  function measureLeft(svg, lo, hi) {
    let width = 0;
    for (let p = Math.round(Math.log10(lo)); p <= Math.round(Math.log10(hi)); p++) {
      const t = svgNode('text', {}, svg);
      t.textContent = (10 ** p >= 1 ? (10 ** p).toLocaleString('en') : String(10 ** p));
      width = Math.max(width, t.getComputedTextLength());
      t.remove();
    }
    return Math.ceil(width) + 12;
  }

  function templateChart(container, engines, templates) {
    container.replaceChildren();
    if (!engines.length) { container.append(node('p', { class: 'note', text: 'No engines selected.' })); return; }
    const values = engines.flatMap((e) => Object.values(e.templates).flatMap((t) => [t.mean, t.min, t.max])).filter((v) => v !== null && v > 0);
    const lo = 10 ** Math.floor(Math.log10(Math.min(...values)));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(...values)));
    const height = 330, top = 24, bottom = height - 32;
    const groupMin = Math.max(engines.length * 4.5 + 12, 36);
    const width = Math.max(container.clientWidth, templates.length * groupMin + 80);
    const inner = node('div', { class: 'chart-inner', style: 'width:' + width + 'px' });
    container.append(inner);
    const svg = svgNode('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Template time per engine, log scale' }, inner);
    const left = measureLeft(svg, lo, hi);
    const y = logScale(lo, hi, top, bottom);
    drawYAxis(svg, lo, hi, y, left, width - 4);
    const unit = svgNode('text', { x: left - 6, y: 12, 'text-anchor': 'end' }, svg);
    unit.textContent = 'ms';
    const step = (width - 4 - left) / templates.length;
    const groupWidth = step * 0.8;
    const barWidth = groupWidth / engines.length;
    const tip = node('div', { class: 'tip', hidden: '' });
    inner.append(tip);
    templates.forEach((t, i) => {
      const x0 = left + i * step + (step - groupWidth) / 2;
      const g = svgNode('g', {}, svg);
      const hover = svgNode('rect', { x: left + i * step, y: top, width: step, height: bottom - top, fill: 'var(--grid)', opacity: 0 }, g);
      engines.forEach((e, j) => {
        const r = e.templates[t];
        if (!r) return;
        const x = x0 + j * barWidth + barWidth * 0.06;
        const w = barWidth * 0.88;
        if (r.mean !== null) {
          svgNode('rect', { x, y: y(r.mean), width: w, height: bottom - y(r.mean), rx: Math.min(2, w / 2), fill: colorOf(e) }, g);
          if (r.min !== null && r.max !== null && r.max > r.min) {
            svgNode('line', { x1: x + w / 2, x2: x + w / 2, y1: y(r.min), y2: y(r.max), stroke: 'var(--fg)', 'stroke-opacity': 0.45 }, g);
          }
        }
        if (r.failed > 0) {
          const peak = r.mean === null ? top + 6 : y(r.max ?? r.mean) - 4;
          svgNode('path', { d: 'M' + (x + w / 2 - 3.5) + ',' + (peak - 6) + 'L' + (x + w / 2 + 3.5) + ',' + (peak - 6) + 'L' + (x + w / 2) + ',' + peak + 'Z', fill: 'var(--bad)' }, g);
        }
      });
      const label = svgNode('text', { x: left + i * step + step / 2, y: bottom + 18, 'text-anchor': 'middle' }, g);
      label.textContent = shortName(t);
      g.addEventListener('pointerenter', () => {
        hover.setAttribute('opacity', 0.7);
        tip.replaceChildren(node('div', { class: 'head', text: t }), ...engines.map((e) => {
          const r = e.templates[t];
          let text = '—';
          if (r) {
            text = r.mean === null ? r.failed + ' failed' : ms(r.mean) + ' ms' + (r.min !== null && r.max !== null ? ' (' + ms(r.min) + '–' + ms(r.max) + ')' : '') + (r.failed ? ', ' + r.failed + ' failed' : '');
          }
          return node('div', { class: 'row' }, swatch(e), node('span', { text: e.label }), node('span', { text }));
        }));
        tip.hidden = false;
        const tw = tip.offsetWidth;
        const right = left + (i + 1) * step + 6;
        tip.style.left = (right + tw > width ? Math.max(0, left + i * step - tw - 6) : right) + 'px';
        tip.style.top = top + 'px';
      });
      g.addEventListener('pointerleave', () => { hover.setAttribute('opacity', 0); tip.hidden = true; });
    });
    svgNode('line', { x1: left, x2: width - 4, y1: bottom, y2: bottom, stroke: 'var(--axis)' }, svg);
  }

  function scalingCard(runs) {
    const scaled = runs.filter((r) => r.scale !== null);
    if (new Set(scaled.map((r) => r.scale)).size < 2) return null;
    const chart = node('div', { class: 'chart' });
    const draw = () => scalingChart(chart, scaled);
    requestAnimationFrame(draw);
    new ResizeObserver(() => draw()).observe(chart);
    return node('div', { class: 'card' },
      node('h3', { text: 'Across scales' }),
      node('p', { class: 'note', text: 'Each engine\\u2019s time relative to ' + refLabel + ' at every scale (log scale, below 1 is faster). Hover a point for its values.' }),
      chart);
  }

  function scalingChart(container, runs) {
    container.replaceChildren();
    const series = new Map();
    runs.forEach((run, i) => {
      for (const row of analyze(run).rows) {
        if (row.missing || row.relative === null) continue;
        if (!series.has(row.engine.name)) series.set(row.engine.name, { engine: row.engine, points: [] });
        series.get(row.engine.name).points.push({ i, run, row });
      }
    });
    const values = [...series.values()].flatMap((s) => s.points.map((p) => p.row.relative));
    if (!values.length) return;
    const lo = 10 ** Math.floor(Math.log10(Math.min(...values, 1)));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(...values, 1)));
    const height = 300, top = 16, bottom = height - 32;
    const labelRoom = 170;
    const width = Math.max(container.clientWidth, runs.length * 90 + 120 + labelRoom);
    const inner = node('div', { class: 'chart-inner', style: 'width:' + width + 'px' });
    container.append(inner);
    const svg = svgNode('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Time relative to the reference per scale' }, inner);
    const left = measureLeft(svg, lo, hi);
    const y = logScale(lo, hi, top, bottom);
    drawYAxis(svg, lo, hi, y, left, width - 4);
    const xs = runs.map((_, i) => left + 40 + i * ((width - left - 80 - labelRoom) / Math.max(1, runs.length - 1)));
    runs.forEach((run, i) => {
      const t = svgNode('text', { x: xs[i], y: bottom + 18, 'text-anchor': 'middle' }, svg);
      t.textContent = run.scaleLabel || runName(run);
    });
    svgNode('line', { x1: left, x2: xs[xs.length - 1] + 12, y1: y(1), y2: y(1), stroke: 'var(--axis)', 'stroke-dasharray': '4 3' }, svg);
    const tip = node('div', { class: 'tip', hidden: '' });
    inner.append(tip);
    for (const { engine, points } of series.values()) {
      const color = colorOf(engine);
      svgNode('polyline', { points: points.map((p) => xs[p.i] + ',' + y(p.row.relative)).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      for (const p of points) {
        const dot = svgNode('circle', { cx: xs[p.i], cy: y(p.row.relative), r: 4, fill: color }, svg);
        dot.addEventListener('pointerenter', () => {
          tip.replaceChildren(node('div', { class: 'head', text: (p.run.scaleLabel || runName(p.run)) }),
            node('div', { class: 'row' }, swatch(engine), node('span', { text: engine.label }), node('span', { text: ratio(p.row.relative) + ' (' + p.row.shared + ' shared), ' + ms(p.row.geomean) + ' ms' })));
          tip.hidden = false;
          const tw = tip.offsetWidth;
          tip.style.left = Math.min(Math.max(0, xs[p.i] + 8), width - tw) + 'px';
          tip.style.top = Math.max(0, y(p.row.relative) - 40) + 'px';
        });
        dot.addEventListener('pointerleave', () => { tip.hidden = true; });
      }
    }
    svgNode('line', { x1: left, x2: xs[xs.length - 1] + 12, y1: bottom, y2: bottom, stroke: 'var(--axis)' }, svg);
    // Name each line at its last point, moved apart where they would overlap.
    const ends = [...series.values()].map(({ engine, points }) => ({ engine, p: points[points.length - 1] }))
      .map((s) => ({ ...s, y: y(s.p.row.relative) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 13);
    for (const end of ends) {
      const t = svgNode('text', { x: xs[xs.length - 1] + 18, y: end.y, dy: '0.32em' }, svg);
      t.textContent = end.engine.label;
      t.style.fill = colorOf(end.engine);
    }
  }

  renderTabs();
  render();
})();
</script>
</body>
</html>
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = collect(args.inputs);
  if (runs.length === 0) {
    throw new Error('No experiment results found');
  }
  const data = { title: args.title, reference: args.reference, generatedAt: new Date().toISOString(), runs };
  if (args.saveData) {
    fs.writeFileSync(args.saveData, `${JSON.stringify({ runs }, null, 1)}\n`);
    console.log(`Wrote the results of ${runs.length} runs to ${args.saveData}`);
  }
  if (args.output) {
    fs.writeFileSync(args.output, toHtml(data));
    console.log(`Wrote ${args.output} with ${runs.length} runs`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { collect, toHtml };
