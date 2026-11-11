#!/usr/bin/env node
// Summarizes load times, ingestion times and store sizes of all combinations of an experiment into a CSV file,
// and plots ingestion times and store sizes as SVG bar charts.
//
// Usage: node scripts/load-times.js <experiment-dir> [--labels A,B,C] [--name plot_load_times]
//
// Per combination, it reads:
// - output/logs/load-time.csv: time (ms) from starting the endpoint until it is available (written by jbr).
// - Ingestion time (s), from the first source that exists:
//   - A "JBR_INGESTION_TIME_S <seconds>" line in any log file in output/logs (printed by the engine startup scripts,
//     and for Comunica by input/comunica-ingestion-timer.js, which times only loading the dataset).
//   - output/logs/sparql-endpoint-comunica-preload-time.csv (ms, written by the Comunica hook if preloadQuery is set),
//     only if Comunica did not warm up: a warm-up loads the dataset before the preload query, which then measures no loading.
// - Store size: a "JBR_STORE_SIZE_BYTES <bytes> <memory|disk>" line in any log file in output/logs (printed by the engine startup
//   scripts and input/comunica-ingestion-timer.js): the memory that the loaded dataset takes for in-memory engines, or the size of
//   the index on disk for the others.
const fs = require('node:fs');
const path = require('node:path');

const MARKER = /JBR_INGESTION_TIME_S ([\d.]+)/u;
const STORE_SIZE_MARKER = /JBR_STORE_SIZE_BYTES (-?\d+) (\w+)/u;
const WARMUP = /warmed up with \d+ query executions/u;

function parseArgs(argv) {
  const args = { experimentDir: undefined, labels: undefined, name: 'plot_load_times' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--labels') {
      args.labels = argv[++i].split(',');
    } else if (argv[i] === '--name') {
      args.name = argv[++i];
    } else {
      args.experimentDir = argv[i];
    }
  }
  if (!args.experimentDir) {
    throw new Error('Usage: node scripts/load-times.js <experiment-dir> [--labels A,B,C] [--name plot_load_times]');
  }
  return args;
}

function readCsvTime(file) {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return Number(fs.readFileSync(file, 'utf8').trim().split('\n')[1]);
}

function readIngestionTime(logsDir) {
  const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.txt')).sort();
  for (const file of logFiles) {
    const match = MARKER.exec(fs.readFileSync(path.join(logsDir, file), 'utf8'));
    if (match) {
      return Math.round(Number(match[1]) * 1000);
    }
  }
  const comunicaLog = path.join(logsDir, 'sparql-endpoint-comunica.txt');
  if (fs.existsSync(comunicaLog) && WARMUP.test(fs.readFileSync(comunicaLog, 'utf8'))) {
    return undefined;
  }
  return readCsvTime(path.join(logsDir, 'sparql-endpoint-comunica-preload-time.csv'));
}

function readStoreSize(logsDir) {
  for (const file of fs.readdirSync(logsDir).filter(f => f.endsWith('.txt')).sort()) {
    const match = STORE_SIZE_MARKER.exec(fs.readFileSync(path.join(logsDir, file), 'utf8'));
    if (match) {
      return { bytes: Number(match[1]), kind: match[2] };
    }
  }
  return undefined;
}

function collect(experimentDir, labels) {
  const combinations = JSON.parse(fs.readFileSync(path.join(experimentDir, 'jbr-combinations.json'), 'utf8')).combinations;
  const rows = [];
  combinations.forEach((combination, i) => {
    const logsDir = path.join(experimentDir, 'combinations', `combination_${i}`, 'output', 'logs');
    const loadTime = readCsvTime(path.join(logsDir, 'load-time.csv'));
    if (loadTime === undefined) {
      return;
    }
    rows.push({
      label: labels ? labels[i] : combination.name,
      loadTime,
      ingestionTime: readIngestionTime(logsDir),
      storeSize: readStoreSize(logsDir),
    });
  });
  return rows;
}

function toCsv(rows) {
  const lines = [ 'combination;load_time_ms;ingestion_time_ms;store_size_mib;store_size_kind' ];
  for (const row of rows) {
    const storeSize = row.storeSize ? `${(row.storeSize.bytes / 1024 / 1024).toFixed(1)};${row.storeSize.kind}` : ';';
    lines.push(`${row.label};${row.loadTime};${row.ingestionTime ?? ''};${storeSize}`);
  }
  return `${lines.join('\n')}\n`;
}

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Horizontal bars of one value per combination, such as the ingestion time (startup time is not relevant for comparing engines).
// The label of a bar, and of the axis maximum, is formatted by format(value, row), where row is undefined for the axis.
function toSvg(rows, value, format, title) {
  const barHeight = 20;
  const gap = 8;
  const labelWidth = 160;
  const plotWidth = 480;
  const top = 10;
  const max = Math.max(...rows.map(row => value(row) ?? 0));
  const scale = max > 0 ? plotWidth / max : 0;
  const height = top + rows.length * (barHeight + gap) + 40;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth + plotWidth + 80}" height="${height}" font-family="sans-serif" font-size="12">`,
  ];
  rows.forEach((row, i) => {
    const y = top + i * (barHeight + gap);
    const width = value(row) === undefined ? 0 : value(row) * scale;
    const label = value(row) === undefined ? 'n/a' : format(value(row), row);
    parts.push(`<text x="${labelWidth - 6}" y="${y + 14}" text-anchor="end">${escapeXml(row.label)}</text>`);
    parts.push(`<rect x="${labelWidth}" y="${y}" width="${width.toFixed(1)}" height="${barHeight}" fill="#2a6f97"/>`);
    parts.push(`<text x="${(labelWidth + width + 4).toFixed(1)}" y="${y + 14}">${label}</text>`);
  });
  const axisY = top + rows.length * (barHeight + gap) + 4;
  parts.push(`<line x1="${labelWidth}" y1="${axisY}" x2="${labelWidth + plotWidth}" y2="${axisY}" stroke="#555"/>`);
  parts.push(`<text x="${labelWidth}" y="${axisY + 16}">0</text>`);
  parts.push(`<text x="${labelWidth + plotWidth}" y="${axisY + 16}" text-anchor="end">${format(max)}</text>`);
  parts.push(`<text x="${labelWidth + plotWidth / 2}" y="${axisY + 32}" text-anchor="middle">${title}</text>`);
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
const rows = collect(args.experimentDir, args.labels);
if (rows.length === 0) {
  throw new Error(`No load times found in ${args.experimentDir}, run the experiment first`);
}
fs.writeFileSync(path.join(args.experimentDir, `${args.name}.csv`), toCsv(rows));
fs.writeFileSync(path.join(args.experimentDir, `${args.name}.svg`), toSvg(
  rows,
  row => row.ingestionTime === undefined ? undefined : row.ingestionTime / 1000,
  seconds => `${seconds.toFixed(1)}s`,
  'Data ingestion time',
));
fs.writeFileSync(path.join(args.experimentDir, `${args.name}_store_size.svg`), toSvg(
  rows,
  row => row.storeSize === undefined ? undefined : row.storeSize.bytes / 1024 / 1024,
  (mebibytes, row) => `${mebibytes.toFixed(0)} MiB${row ? ` (${row.storeSize.kind})` : ''}`,
  'Store size (in memory or on disk)',
));
console.log(`Wrote ${args.name}.csv, ${args.name}.svg and ${args.name}_store_size.svg for ${rows.length} combinations`);
