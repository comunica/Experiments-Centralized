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
// The page, in which %TITLE% and %DATA% are replaced.
const TEMPLATE_FILE = path.join(__dirname, 'report-template.html');

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
  // Engines report ingestion with this marker in their logs; for Comunica, input/comunica-ingestion-timer.js prints it.
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
  return fs.readFileSync(TEMPLATE_FILE, 'utf8')
    .replace('%TITLE%', () => title)
    .replace('%DATA%', () => json);
}

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
