# JB Racks Vehicle Fitment Checker — Technical Solution

## Overview

A rego-based vehicle fitment tool embedded on Shopify product pages. Customers enter their registration plate + state, the system looks up their vehicle via the RegCheck API, then matches it against JB Racks' hitch compatibility database to confirm whether their car has a 2" hitch receiver and which products fit.

---

## Architecture

```
Customer enters rego + state on product page
        ↓
Shopify theme JS → POST to Vercel Edge Function
        ↓
Vercel Edge Function:
  1. Calls RegCheck /CheckAustralia API
  2. Parses vehicle response (make, model, year, variant)
  3. Loads hitch-compatibility.json (bundled in deployment)
  4. Fuzzy-matches vehicle against compatibility DB
  5. Returns { vehicle, compatible: true/false, matchedEntry }
        ↓
Shopify theme JS renders result on product page
```

---

## Component 1: Hitch Compatibility CSV → JSON

### CSV Format (`hitch-compatibility.csv`)

```csv
make,model,year_from,year_to,variant,has_2inch_hitch,notes
Toyota,HiLux,2015,2025,SR5,true,Factory towbar with 2" receiver
Toyota,HiLux,2015,2025,Rugged,true,Factory towbar with 2" receiver
Toyota,LandCruiser,2007,2021,200 Series,true,
Toyota,LandCruiser,2021,2025,300 Series,true,
Ford,Ranger,2011,2025,XLT,true,
Ford,Ranger,2011,2025,Wildtrak,true,
Nissan,Navara,2014,2025,ST-X,true,
Mitsubishi,Triton,2015,2025,GLS,true,
Isuzu,D-Max,2020,2025,X-Terrain,true,
Mazda,BT-50,2020,2025,GT,true,
Toyota,RAV4,2019,2025,GXL,false,Aftermarket hitch available - not factory 2 inch
Hyundai,Tucson,2021,2025,Highlander,false,No 2" hitch option
```

### Build Script (`build-compatibility.js`)

```javascript
// Run: node build-compatibility.js
// Converts CSV to optimised JSON for the Vercel function

const fs = require('fs');
const path = require('path');

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
```

---

## Component 2: Vercel Edge Function

### Project Structure

```
vercel-vehicle-proxy/
├── api/
│   └── vehicle-lookup.js    ← Edge function
├── data/
│   ├── hitch-compatibility.csv
│   └── hitch-compatibility.json  ← Generated
├── lib/
│   └── matcher.js           ← Fuzzy matching logic
├── build-compatibility.js
├── package.json
└── vercel.json
```

### `vercel.json`

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "https://your-store.myshopify.com" },
        { "key": "Access-Control-Allow-Methods", "value": "POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type" }
      ]
    }
  ]
}
```

### `api/vehicle-lookup.js`

```javascript
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

  try {
    // 1. Call RegCheck API
    const apiUrl = `https://www.regcheck.org.uk/api/reg.asmx/CheckAustralia?RegistrationNumber=${encodeURIComponent(rego)}&username=${encodeURIComponent(username)}&State=${encodeURIComponent(state)}`;

    const apiRes = await fetch(apiUrl);
    const xml = await apiRes.text();

    // 2. Extract vehicleJson from XML response
    const jsonMatch = xml.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/);
    if (!jsonMatch) {
      return res.status(404).json({ error: 'Vehicle not found', raw: xml });
    }

    // Decode XML entities and parse JSON
    const jsonStr = jsonMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const vehicle = JSON.parse(jsonStr);

    // 3. Extract fields for matching
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

    // 4. Match against compatibility DB
    const match = matchVehicle(make, model, year, variant);

    // 5. Return result
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
    return res.status(500).json({ error: 'Lookup failed. Please try again.' });
  }
}
```

### Environment Variables (Vercel Dashboard)

```
REGCHECK_USERNAME=your_regcheck_username
```

---

## Component 3: Shopify Theme Integration

### Snippet: `snippets/vehicle-fitment.liquid`

Add this file to your Shopify theme, then include it in your product template with `{% render 'vehicle-fitment' %}`.

```html
<div id="jb-fitment-checker" class="jb-fitment">
  <div class="jb-fitment__header">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>
    </svg>
    <span>Does this rack fit your vehicle?</span>
  </div>

  <div class="jb-fitment__form">
    <div class="jb-fitment__row">
      <select id="jb-state" class="jb-fitment__select">
        <option value="">State</option>
        <option value="QLD">QLD</option>
        <option value="NSW">NSW</option>
        <option value="VIC">VIC</option>
        <option value="SA">SA</option>
        <option value="WA">WA</option>
        <option value="TAS">TAS</option>
        <option value="ACT">ACT</option>
        <option value="NT">NT</option>
      </select>
      <input
        type="text"
        id="jb-rego"
        class="jb-fitment__input"
        placeholder="Enter your rego"
        maxlength="10"
        autocomplete="off"
      />
      <button id="jb-lookup-btn" class="jb-fitment__btn" onclick="JBFitment.lookup()">
        Check Fitment
      </button>
    </div>
  </div>

  <div id="jb-fitment-result" class="jb-fitment__result" style="display:none;"></div>
</div>

<style>
  .jb-fitment {
    border: 2px solid #e5e5e5;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    font-family: inherit;
  }
  .jb-fitment__header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 15px;
    margin-bottom: 16px;
  }
  .jb-fitment__row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .jb-fitment__select {
    padding: 10px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
    min-width: 80px;
  }
  .jb-fitment__input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
    text-transform: uppercase;
    min-width: 140px;
  }
  .jb-fitment__btn {
    padding: 10px 20px;
    background: #000;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .jb-fitment__btn:hover { opacity: 0.85; }
  .jb-fitment__btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .jb-fitment__result {
    margin-top: 16px;
    padding: 16px;
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.5;
  }
  .jb-fitment__result--compatible {
    background: #f0fdf4;
    border: 1px solid #86efac;
    color: #166534;
  }
  .jb-fitment__result--incompatible {
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #991b1b;
  }
  .jb-fitment__result--unknown {
    background: #fffbeb;
    border: 1px solid #fcd34d;
    color: #92400e;
  }
  .jb-fitment__result--error {
    background: #f9fafb;
    border: 1px solid #d1d5db;
    color: #374151;
  }
  .jb-fitment__vehicle {
    font-weight: 600;
    margin-bottom: 4px;
  }

  @media (max-width: 480px) {
    .jb-fitment__row { flex-direction: column; }
    .jb-fitment__select { width: 100%; }
  }
</style>

<script>
  const JBFitment = {
    API_URL: 'https://your-vercel-app.vercel.app/api/vehicle-lookup',

    async lookup() {
      const state = document.getElementById('jb-state').value;
      const rego = document.getElementById('jb-rego').value.trim().toUpperCase();
      const btn = document.getElementById('jb-lookup-btn');
      const resultDiv = document.getElementById('jb-fitment-result');

      if (!state || !rego) {
        this.showResult('error', 'Please select your state and enter your rego.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Checking...';
      resultDiv.style.display = 'none';

      try {
        const res = await fetch(this.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rego, state }),
        });

        const data = await res.json();

        if (!res.ok) {
          this.showResult('error', data.error || 'Lookup failed. Please try again.');
          return;
        }

        const { vehicle, fitment } = data;
        const vehicleName = vehicle.description || `${vehicle.make} ${vehicle.model} (${vehicle.year})`;

        if (fitment.compatible === true) {
          this.showResult('compatible',
            `<div class="jb-fitment__vehicle">✅ ${vehicleName}</div>
             Great news! Your vehicle has a compatible 2" hitch receiver. This rack will fit your ${vehicle.make}.
             ${fitment.notes ? `<br><small>${fitment.notes}</small>` : ''}`
          );
        } else if (fitment.compatible === false) {
          this.showResult('incompatible',
            `<div class="jb-fitment__vehicle">❌ ${vehicleName}</div>
             Unfortunately, your vehicle doesn't have a standard 2" hitch receiver.
             ${fitment.notes ? `<br><small>${fitment.notes}</small>` : ''}
             <br><a href="/pages/contact" style="color:inherit;text-decoration:underline;">Contact us</a> for alternative mounting options.`
          );
        } else {
          this.showResult('unknown',
            `<div class="jb-fitment__vehicle">⚠️ ${vehicleName}</div>
             We couldn't confirm fitment for your specific vehicle.
             <br><a href="/pages/contact" style="color:inherit;text-decoration:underline;">Contact us</a> and we'll check compatibility for you.`
          );
        }

        // Optional: track the lookup in GA4
        if (typeof gtag === 'function') {
          gtag('event', 'vehicle_fitment_check', {
            vehicle_make: vehicle.make,
            vehicle_model: vehicle.model,
            vehicle_year: vehicle.year,
            fitment_result: fitment.compatible === true ? 'compatible' : fitment.compatible === false ? 'incompatible' : 'unknown',
          });
        }

      } catch (err) {
        this.showResult('error', 'Something went wrong. Please try again.');
        console.error('JB Fitment error:', err);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Check Fitment';
      }
    },

    showResult(type, html) {
      const resultDiv = document.getElementById('jb-fitment-result');
      resultDiv.className = `jb-fitment__result jb-fitment__result--${type}`;
      resultDiv.innerHTML = html;
      resultDiv.style.display = 'block';
    }
  };

  // Allow Enter key to trigger lookup
  document.getElementById('jb-rego')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') JBFitment.lookup();
  });
</script>
```

---

## Deployment Checklist

### 1. Build your hitch compatibility CSV
- Populate `hitch-compatibility.csv` with all known vehicles and their 2" hitch status
- Run `node build-compatibility.js` to generate the JSON index

### 2. Deploy Vercel function
```bash
cd vercel-vehicle-proxy
npm init -y
vercel env add REGCHECK_USERNAME    # Add your RegCheck API username
vercel deploy --prod
```

### 3. Update Shopify theme
- Add `snippets/vehicle-fitment.liquid` to your theme
- Update `API_URL` in the script to your Vercel deployment URL
- Add `{% render 'vehicle-fitment' %}` to your product template (e.g. `sections/main-product.liquid`)
- Update CORS in `vercel.json` to match your actual Shopify domain

### 4. Test with free rego numbers
| State | Test Rego | Expected Vehicle |
|-------|-----------|-----------------|
| NSW   | BEW76P    | Ford Fairmont 1994 |
| VIC   | ZZA271    | Hyundai Wagon 2012 |
| QLD   | 949RWP    | Hyundai Accent 2011 |

### 5. Update CORS for all store domains
In `vercel.json`, set allowed origins for:
- `https://jbracks.com.au` (AU store)
- `https://jbracks.com` (US store)
- `https://jbracks.de` (German store — if needed)

---

## Cost Estimate

| Item | Cost |
|------|------|
| RegCheck API | $0.30 per lookup |
| Vercel Hobby plan | Free (100K requests/month) |
| Vercel Pro (if needed) | $20/month |

At ~1,000 fitment checks/month = **$300/month** in API costs. Consider caching repeat lookups in Vercel KV to reduce this.

---

## Optional Enhancements

### Result caching (Vercel KV)
Cache rego lookups for 30 days to avoid repeat API charges for the same vehicle:
```javascript
import { kv } from '@vercel/kv';

const cacheKey = `vehicle:${state}:${rego}`;
const cached = await kv.get(cacheKey);
if (cached) return res.json(cached);

// ... after lookup ...
await kv.set(cacheKey, result, { ex: 60 * 60 * 24 * 30 }); // 30 day TTL
```

### Klaviyo integration
Send the fitment check result to Klaviyo as a custom event for follow-up flows:
```javascript
// After successful lookup, fire Klaviyo event
if (window._learnq) {
  window._learnq.push(['track', 'Vehicle Fitment Check', {
    vehicle_make: vehicle.make,
    vehicle_model: vehicle.model,
    vehicle_year: vehicle.year,
    fitment_result: fitment.compatible ? 'compatible' : 'incompatible',
    product_title: '{{ product.title }}',
  }]);
}
```
This lets you build flows like: "Checked fitment → compatible → didn't purchase → send reminder email."

### Product recommendation
If the vehicle is compatible, auto-filter which specific JB Racks products fit and show them as recommendations below the result.
