# JB Racks Vehicle Fitment Checker

A vehicle compatibility checker for jbracks.com.au that allows customers to verify if their vehicle has a 2" hitch receiver by entering their registration plate number.

## How It Works

1. Customer enters their rego + state on a product page
2. System calls RegCheck API to look up vehicle details
3. Matches vehicle against JB Racks compatibility database
4. Shows whether the vehicle has a compatible 2" hitch receiver

## Project Structure

```
jbracks-fitment/
├── api/
│   └── vehicle-lookup.js          # Vercel edge function
├── data/
│   ├── hitch-compatibility.csv    # Source data (edit this)
│   └── hitch-compatibility.json   # Generated index (don't edit)
├── shopify-theme/
│   └── vehicle-fitment.liquid     # Shopify snippet
├── build-compatibility.js          # Builds JSON from CSV
├── package.json
├── vercel.json                     # CORS + deployment config
└── README.md
```

## Setup Instructions

### 1. Build the Compatibility Database

First, populate `data/hitch-compatibility.csv` with your vehicle compatibility data, then build the JSON index:

```bash
npm run build
```

This generates `data/hitch-compatibility.json` which the API uses for lookups.

### 2. Deploy to Vercel

Install Vercel CLI if you haven't already:

```bash
npm install -g vercel
```

Login to Vercel:

```bash
vercel login
```

Add your RegCheck API username as an environment variable:

```bash
vercel env add REGCHECK_USERNAME
```

When prompted:
- Enter your RegCheck username
- Select "Production" environment
- Confirm

Deploy to production:

```bash
npm run deploy
```

This will:
1. Build the compatibility JSON
2. Deploy to Vercel
3. Give you a production URL like `https://jbracks-fitment.vercel.app`

### 3. Update Shopify Theme

#### Option A: Using Shopify Theme Editor

1. Go to your Shopify admin
2. Navigate to **Online Store > Themes**
3. Click **Edit code** on your active theme
4. Create a new snippet:
   - Click **Add a new snippet**
   - Name it `vehicle-fitment`
   - Copy the contents of `shopify-theme/vehicle-fitment.liquid`
   - Save

5. Edit the snippet to update the API URL:
   - Find the line: `API_URL: 'https://your-vercel-app.vercel.app/api/vehicle-lookup'`
   - Replace with your actual Vercel deployment URL
   - Save

6. Add the snippet to your product template:
   - Open `sections/main-product.liquid` (or your product template)
   - Add `{% render 'vehicle-fitment' %}` where you want it to appear
   - Save

#### Option B: Using Shopify CLI

```bash
cd shopify-theme
shopify theme push
```

### 4. Update CORS Settings

After deployment, update `vercel.json` to include your actual Shopify domain:

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "https://jbracks.com.au"
        }
      ]
    }
  ]
}
```

Then redeploy:

```bash
vercel deploy --prod
```

## Testing

Test with these free Australian rego numbers:

| State | Rego   | Expected Vehicle      |
|-------|--------|----------------------|
| NSW   | BEW76P | Ford Fairmont 1994   |
| VIC   | ZZA271 | Hyundai Wagon 2012   |
| QLD   | 949RWP | Hyundai Accent 2011  |

## Updating Vehicle Data

1. Edit `data/hitch-compatibility.csv`
2. Add/update vehicle entries
3. Run `npm run build` to regenerate JSON
4. Deploy: `vercel deploy --prod`

## CSV Format

```csv
make,model,year_from,year_to,variant,has_2inch_hitch,notes
Toyota,HiLux,2015,2025,SR5,true,Factory towbar with 2" receiver
Ford,Ranger,2011,2025,XLT,true,
Toyota,RAV4,2019,2025,GXL,false,Aftermarket hitch available - not factory 2 inch
```

## Environment Variables

Required in Vercel:

- `REGCHECK_USERNAME` - Your RegCheck API username

To add/update:

```bash
vercel env add REGCHECK_USERNAME
```

## Cost Estimate

- **RegCheck API**: ~$0.30 per lookup
- **Vercel Hobby**: Free (100K requests/month)
- **Vercel Pro**: $20/month (if needed for higher usage)

At 1,000 checks/month = $300/month in API costs.

## Troubleshooting

### API returns "Vehicle not found"

- Check rego format is correct
- Verify state is valid
- Test with known good rego numbers first

### CORS errors in browser console

- Verify `vercel.json` has correct Shopify domain
- Ensure domain includes `https://`
- Redeploy after updating CORS settings

### "Compatible" status not showing correctly

- Check CSV data is formatted correctly
- Verify year ranges are accurate
- Run `npm run build` after CSV changes
- Redeploy to Vercel

## Support

For RegCheck API support: https://www.regcheck.org.uk/contact
For Vercel deployment issues: https://vercel.com/support

## License

MIT
