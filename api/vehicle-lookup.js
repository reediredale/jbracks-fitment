// Compatibility database - embedded to avoid import issues
const compatibilityDB = {
  "TOYOTA": [
    { "make": "Toyota", "model": "HiLux", "year_from": 2015, "year_to": 2025, "variant": "SR5", "has_2inch_hitch": true, "notes": "Factory towbar with 2\" receiver" },
    { "make": "Toyota", "model": "HiLux", "year_from": 2015, "year_to": 2025, "variant": "Rugged", "has_2inch_hitch": true, "notes": "Factory towbar with 2\" receiver" },
    { "make": "Toyota", "model": "LandCruiser", "year_from": 2007, "year_to": 2021, "variant": "200 Series", "has_2inch_hitch": true, "notes": "" },
    { "make": "Toyota", "model": "LandCruiser", "year_from": 2021, "year_to": 2025, "variant": "300 Series", "has_2inch_hitch": true, "notes": "" },
    { "make": "Toyota", "model": "RAV4", "year_from": 2019, "year_to": 2025, "variant": "GXL", "has_2inch_hitch": false, "notes": "Aftermarket hitch available - not factory 2 inch" }
  ],
  "FORD": [
    { "make": "Ford", "model": "Ranger", "year_from": 2011, "year_to": 2025, "variant": "XLT", "has_2inch_hitch": true, "notes": "" },
    { "make": "Ford", "model": "Ranger", "year_from": 2011, "year_to": 2025, "variant": "Wildtrak", "has_2inch_hitch": true, "notes": "" }
  ],
  "NISSAN": [
    { "make": "Nissan", "model": "Navara", "year_from": 2014, "year_to": 2025, "variant": "ST-X", "has_2inch_hitch": true, "notes": "" }
  ],
  "MITSUBISHI": [
    { "make": "Mitsubishi", "model": "Triton", "year_from": 2015, "year_to": 2025, "variant": "GLS", "has_2inch_hitch": true, "notes": "" }
  ],
  "ISUZU": [
    { "make": "Isuzu", "model": "D-Max", "year_from": 2020, "year_to": 2025, "variant": "X-Terrain", "has_2inch_hitch": true, "notes": "" }
  ],
  "MAZDA": [
    { "make": "Mazda", "model": "BT-50", "year_from": 2020, "year_to": 2025, "variant": "GT", "has_2inch_hitch": true, "notes": "" }
  ],
  "HYUNDAI": [
    { "make": "Hyundai", "model": "Tucson", "year_from": 2021, "year_to": 2025, "variant": "Highlander", "has_2inch_hitch": false, "notes": "No 2\" hitch option" }
  ]
};

// Matching logic
function normalise(str) {
  return (str || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function matchVehicle(make, model, year, variant) {
  const normMake = normalise(make);
  let makeEntries = compatibilityDB[normMake];

  if (!makeEntries) {
    const makeKey = Object.keys(compatibilityDB).find(k => normMake.includes(k) || k.includes(normMake));
    if (makeKey) makeEntries = compatibilityDB[makeKey];
  }

  if (!makeEntries) return null;

  const normModel = normalise(model);
  const normVariant = normalise(variant);
  const yearNum = parseInt(year, 10);

  const scored = makeEntries.map(entry => {
    let score = 0;
    const entryModel = normalise(entry.model);
    const entryVariant = normalise(entry.variant);

    if (normModel === entryModel) score += 10;
    else if (normModel.includes(entryModel) || entryModel.includes(normModel)) score += 5;
    else return { entry, score: 0 };

    if (yearNum >= entry.year_from && yearNum <= entry.year_to) score += 5;
    else return { entry, score: 0 };

    if (entryVariant && normVariant) {
      if (normVariant === entryVariant) score += 8;
      else if (normVariant.includes(entryVariant) || entryVariant.includes(normVariant)) score += 3;
    }

    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].entry : null;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { rego, state } = req.body;

  if (!rego || !state) {
    return res.status(400).json({ error: 'rego and state are required' });
  }

  const username = 'jbracks';

  try {
    const apiUrl = `https://www.regcheck.org.uk/api/reg.asmx/CheckAustralia?RegistrationNumber=${encodeURIComponent(rego)}&username=${encodeURIComponent(username)}&State=${encodeURIComponent(state)}`;

    console.log('Calling RegCheck API:', apiUrl);

    const apiRes = await fetch(apiUrl);
    const xml = await apiRes.text();

    console.log('Response status:', apiRes.status);
    console.log('Response (first 500 chars):', xml.substring(0, 500));

    // Check for errors
    const errorMatch = xml.match(/<Message>([\s\S]*?)<\/Message>/);
    if (errorMatch) {
      return res.status(400).json({
        error: 'RegCheck API error',
        details: errorMatch[1]
      });
    }

    // Extract vehicleJson
    const jsonMatch = xml.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/);
    if (!jsonMatch) {
      return res.status(404).json({
        error: 'Vehicle not found',
        details: 'No vehicle data returned from RegCheck API'
      });
    }

    // Parse JSON
    const jsonStr = jsonMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const vehicle = JSON.parse(jsonStr);

    // Extract fields
    const make = vehicle.CarMake?.CurrentTextValue || '';
    const model = vehicle.CarModel?.CurrentTextValue || '';
    const year = vehicle.RegistrationYear || '';
    const variant = vehicle.extended?.variant || vehicle.extended?.series || '';

    // Match against compatibility DB
    const match = matchVehicle(make, model, year, variant);

    // Return result
    return res.status(200).json({
      vehicle: {
        make,
        model,
        year,
        variant,
        description: vehicle.Description || `${make} ${model}`,
        state: vehicle.State || state,
      },
      fitment: match
        ? {
            compatible: match.has_2inch_hitch,
            notes: match.notes || null,
            matchedEntry: {
              make: match.make,
              model: match.model,
              variant: match.variant,
              yearRange: `${match.year_from}-${match.year_to}`,
            },
          }
        : {
            compatible: null,
            notes: 'Vehicle not found in our compatibility database. Contact us for help.',
            matchedEntry: null,
          },
    });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({
      error: err.message,
      stack: err.stack,
      type: err.name
    });
  }
}
