import fs from 'fs';

// Read CSV
const csvContent = fs.readFileSync('./data/hitch-compatibility.csv', 'utf8');
const lines = csvContent.trim().split('\n');
const headers = lines[0].split(',');

// Parse CSV into array of objects
const data = [];
for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',');
  const obj = {};
  headers.forEach((header, index) => {
    let value = values[index];

    // Convert booleans
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    // Convert numbers
    else if (header === 'year_from' || header === 'year_to') {
      value = parseInt(value, 10);
    }

    obj[header] = value;
  });
  data.push(obj);
}

// Group by make
const db = {};
data.forEach(entry => {
  const make = entry.make.toUpperCase();
  if (!db[make]) db[make] = [];
  db[make].push({
    make: entry.make,
    model: entry.model,
    year_from: entry.year_from,
    year_to: entry.year_to,
    variant: entry.variant,
    has_2inch_hitch: entry.has_2inch_hitch,
    notes: entry.notes
  });
});

// Write JSON
fs.writeFileSync('./data/hitch-compatibility.json', JSON.stringify(db, null, 2));
console.log(`JSON file created: data/hitch-compatibility.json (${data.length} vehicles)`);
