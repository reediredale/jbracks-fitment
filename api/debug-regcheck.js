export default async function handler(req, res) {
  // Allow CORS
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
    console.log('Response headers:', Object.fromEntries(apiRes.headers.entries()));
    console.log('Response body:', xml);

    // Return raw response for debugging
    return res.status(200).json({
      success: true,
      apiUrl: apiUrl,
      status: apiRes.status,
      headers: Object.fromEntries(apiRes.headers.entries()),
      rawXml: xml,
      contentType: apiRes.headers.get('content-type')
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
