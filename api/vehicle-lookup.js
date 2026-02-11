import compatibilityDB from '../data/hitch-compatibility.json';

// --- Matching logic ---

function normalise(str) {
  return (str || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchVehicle(make, model, year, variant) {
  const normMake = normalise(make);

  // Try exact make key first, then partial match
  let makeEntries = compatibilityDB[normMake];
  if (!makeEntries) {
    // Fuzzy: find makes that contain or are contained in the lookup
    const makeKey = Object.keys(compatibilityDB).find(k =>
      normMake.includes(k) || k.includes(normMake)
    );
    if (makeKey) makeEntries = compatibilityDB[makeKey];
  }

  if (!makeEntries) return null;

  const normModel = normalise(model);
  const normVariant = normalise(variant);
  const yearNum = parseInt(year, 10);

  // Score each entry
  const scored = makeEntries.map(entry => {
    let score = 0;
    const entryModel = normalise(entry.model);
    const entryVariant = normalise(entry.variant);

    // Model match (required)
    if (normModel === entryModel) score += 10;
    else if (normModel.includes(entryModel) || entryModel.includes(normModel)) score += 5;
    else return { entry, score: 0 }; // No model match = skip

    // Year in range
    if (yearNum >= entry.year_from && yearNum <= entry.year_to) score += 5;
    else return { entry, score: 0 }; // Out of year range = skip

    // Variant match (bonus, not required)
    if (entryVariant && normVariant) {
      if (normVariant === entryVariant) score += 8;
      else if (normVariant.includes(entryVariant) || entryVariant.includes(normVariant)) score += 3;
    }

    return { entry, score };
  });

  // Best match with score > 0
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].entry : null;
}

// --- API handler ---

export default async function handler(req, res) {
  // Handle CORS preflight
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

  const username = process.env.REGCHECK_USERNAME;

  // Check if username is configured
  if (!username) {
    return res.status(500).json({
      error: 'API configuration error',
      details: 'REGCHECK_USERNAME environment variable is not set'
    });
  }

  try {
    // 1. Call RegCheck API
    const apiUrl = `https://www.regcheck.org.uk/api/reg.asmx/CheckAustralia?RegistrationNumber=${encodeURIComponent(rego)}&username=${encodeURIComponent(username)}&State=${encodeURIComponent(state)}`;

    const apiRes = await fetch(apiUrl);
    const xml = await apiRes.text();

    // Log response for debugging
    console.log('RegCheck API response status:', apiRes.status);
    console.log('RegCheck API response (first 500 chars):', xml.substring(0, 500));

    // 2. Check for API errors in XML
    const errorMatch = xml.match(/<Message>([\s\S]*?)<\/Message>/);
    if (errorMatch) {
      return res.status(400).json({
        error: 'RegCheck API error',
        details: errorMatch[1],
        apiResponse: xml
      });
    }

    // 3. Extract vehicleJson from XML response
    const jsonMatch = xml.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/);
    if (!jsonMatch) {
      return res.status(404).json({
        error: 'Vehicle not found',
        details: 'No vehicle data returned from RegCheck API',
        apiResponse: xml.substring(0, 1000)
      });
    }

    // 4. Decode XML entities and parse JSON
    const jsonStr = jsonMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const vehicle = JSON.parse(jsonStr);

    // 5. Extract fields for matching
    const make = vehicle.CarMake?.CurrentTextValue
              || vehicle.MakeDescription?.CurrentTextValue
              || '';
    const model = vehicle.CarModel?.CurrentTextValue
              || vehicle.ModelDescription?.CurrentTextValue
              || '';
    const year = vehicle.RegistrationYear || '';
    const variant = vehicle.extended?.variant
                 || vehicle.extended?.series
                 || '';

    // 6. Match against compatibility DB
    const match = matchVehicle(make, model, year, variant);

    // 7. Return result
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
            compatible: null, // Unknown — not in our DB
            notes: 'Vehicle not found in our compatibility database. Contact us for help.',
            matchedEntry: null,
          },
    });
  } catch (err) {
    console.error('Vehicle lookup error:', err);
    return res.status(500).json({
      error: 'Lookup failed',
      details: err.message,
      type: err.name
    });
  }
}
