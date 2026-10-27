#!/usr/bin/env node
// Summarizes endpoint load times of all combinations of an experiment into a CSV file and an SVG bar chart.
//
// Usage: node scripts/load-times.js <experiment-dir> [--labels A,B,C] [--name plot_load_times]
//
// Per combination, it reads:
// - output/logs/load-time.csv: time (ms) from starting the endpoint until it is available (written by jbr).
// - Ingestion time (s), from the first source that exists:
//   - output/logs/sparql-endpoint-comunica-preload-time.csv (ms, written by the Comunica hook if preloadQuery is set).
//   - A "JBR_INGESTION_TIME_S <seconds>" line in any log file in output/logs (printed by the engine startup scripts).
const fs = require('node:fs');
const path = require('node:path');

const MARKER = /JBR_INGESTION_TIME_S ([\d.]+)/u;

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
  const preloadTime = readCsvTime(path.join(logsDir, 'sparql-endpoint-comunica-preload-time.csv'));
  if (preloadTime !== undefined) {
    return preloadTime;
  }
  for (const file of fs.readdirSync(logsDir).filter(f => f.endsWith('.txt')).sort()) {
    const match = MARKER.exec(fs.readFileSync(path.join(logsDir, file), 'utf8'));
    if (match) {
      return Math.round(Number(match[1]) * 1000);
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
    });
  });
  return rows;
}

function toCsv(rows) {
  const lines = [ 'combination;load_time_ms;ingestion_time_ms' ];
  for (const row of rows) {
    lines.push(`${row.label};${row.loadTime};${row.ingestionTime ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Horizontal bars: ingestion time, plus the remainder of the load time (startup and other overhead)
function toSvg(rows) {
  const barHeight = 20;
  const gap = 8;
  const labelWidth = 160;
  const plotWidth = 480;
  const top = 30;
  const maxSeconds = Math.max(...rows.map(row => row.loadTime)) / 1000;
  const scale = plotWidth / maxSeconds;
  const height = top + rows.length * (barHeight + gap) + 40;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth + plotWidth + 200}" height="${height}" font-family="sans-serif" font-size="12">`,
    `<rect x="${labelWidth}" y="6" width="12" height="12" fill="#2a6f97"/><text x="${labelWidth + 16}" y="16">Ingestion</text>`,
    `<rect x="${labelWidth + 90}" y="6" width="12" height="12" fill="#a9cce3"/><text x="${labelWidth + 106}" y="16">Other startup</text>`,
  ];
  rows.forEach((row, i) => {
    const y = top + i * (barHeight + gap);
    const ingestionWidth = row.ingestionTime === undefined ? 0 : row.ingestionTime / 1000 * scale;
    const totalWidth = row.loadTime / 1000 * scale;
    parts.push(`<text x="${labelWidth - 6}" y="${y + 14}" text-anchor="end">${escapeXml(row.label)}</text>`);
    parts.push(`<rect x="${labelWidth}" y="${y}" width="${ingestionWidth.toFixed(1)}" height="${barHeight}" fill="#2a6f97"/>`);
    parts.push(`<rect x="${(labelWidth + ingestionWidth).toFixed(1)}" y="${y}" width="${Math.max(totalWidth - ingestionWidth, 0).toFixed(1)}" height="${barHeight}" fill="#a9cce3"/>`);
    const ingestionLabel = row.ingestionTime === undefined ? 'n/a' : `${(row.ingestionTime / 1000).toFixed(1)}s`;
    parts.push(`<text x="${(labelWidth + totalWidth + 4).toFixed(1)}" y="${y + 14}">${(row.loadTime / 1000).toFixed(1)}s (ingestion ${ingestionLabel})</text>`);
  });
  const axisY = top + rows.length * (barHeight + gap) + 4;
  parts.push(`<line x1="${labelWidth}" y1="${axisY}" x2="${labelWidth + plotWidth}" y2="${axisY}" stroke="#555"/>`);
  parts.push(`<text x="${labelWidth}" y="${axisY + 16}">0</text>`);
  parts.push(`<text x="${labelWidth + plotWidth}" y="${axisY + 16}" text-anchor="end">${maxSeconds.toFixed(1)}s</text>`);
  parts.push(`<text x="${labelWidth + plotWidth / 2}" y="${axisY + 32}" text-anchor="middle">Endpoint load time</text>`);
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
const rows = collect(args.experimentDir, args.labels);
if (rows.length === 0) {
  throw new Error(`No load times found in ${args.experimentDir}, run the experiment first`);
}
fs.writeFileSync(path.join(args.experimentDir, `${args.name}.csv`), toCsv(rows));
fs.writeFileSync(path.join(args.experimentDir, `${args.name}.svg`), toSvg(rows));
console.log(`Wrote ${args.name}.csv and ${args.name}.svg for ${rows.length} combinations`);
