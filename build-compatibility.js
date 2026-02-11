// Run: node build-compatibility.js
// Converts CSV to optimised JSON for the Vercel function

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csv = fs.readFileSync(
  path.join(__dirname, 'data', 'hitch-compatibility.csv'), 'utf-8'
);

const lines = csv.trim().split('\n');
const headers = lines[0].split(',');
const entries = [];

for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',');
  const entry = {};
  headers.forEach((h, idx) => {
    let val = values[idx]?.trim() || '';
    if (h === 'has_2inch_hitch') val = val === 'true';
    if (h === 'year_from' || h === 'year_to') val = parseInt(val, 10);
    entry[h] = val;
  });
  entries.push(entry);
}

// Build a lookup index keyed by normalised make
const index = {};
for (const entry of entries) {
  const key = entry.make.toUpperCase();
  if (!index[key]) index[key] = [];
  index[key].push(entry);
}

fs.writeFileSync(
  path.join(__dirname, 'data', 'hitch-compatibility.json'),
  JSON.stringify(index, null, 2)
);

console.log(`Built compatibility DB: ${entries.length} entries, ${Object.keys(index).length} makes`);
