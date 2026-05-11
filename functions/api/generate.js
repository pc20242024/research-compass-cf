// functions/api/generate.js
// Cloudflare Pages Function — runs server-side, API key never exposed to browser

const GEMINI_MODEL = 'gemini-2.5-flash';

const ALLOWED_SECTORS = new Set([
  'AI & New Technologies',
  'Mining & Energy',
  'Agriculture, Forestry & Fishing',
  'Manufacturing & Industrial Production',
  'Construction & Infrastructure',
  'Retail & Wholesale Trade',
  'Transport, Logistics & Supply Chain',
  'Professional & Financial Services',
  'Healthcare & Life Sciences',
  'Education & Training',
  'Media & Communication',
  'Hospitality, Tourism & Leisure',
  'Arts, Culture & Creative Industries',
  'Nonprofit, NGO & Social Services',
  'Government & Public Administration',
]);

// Rate limit: max 5 requests per IP per hour
const ipLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 5;
  const entry = ipLog.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    ipLog.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= max) return true;
  entry.count++;
  ipLog.set(ip, entry);
  return false;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Frame-Options': 'ALLOWALL',
    'Content-Security-Policy': 'frame-ancestors *',
  };

  // Rate limiting
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please try again in an hour.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const { sector, keywords = [], isRegen = false } = body;

  // Validate sector
  if (!sector || !ALLOWED_SECTORS.has(sector)) {
    return new Response(
      JSON.stringify({ error: 'Invalid sector.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Sanitise keywords
  const cleanKeywords = Array.isArray(keywords)
    ? keywords.filter(k => typeof k === 'string').map(k => k.trim().slice(0, 60)).filter(Boolean).slice(0, 10)
    : [];

  const kwSection = cleanKeywords.length > 0
    ? `\n\nThe candidate has provided the following research interest or context: "${cleanKeywords.join(' ')}". Generate ALL 5 thesis ideas specifically around this topic. This is not optional — every single thesis must directly address this specific research interest. Treat it as the brief you have been given.`
    : '';

  const kwInTitle = cleanKeywords.length > 0
    ? `The candidate's specific research interest is: "${cleanKeywords.join(' ')}". Every thesis title must directly reference or be about this topic.`
    : 'Generate 5 diverse thesis ideas relevant to senior executives in this sector.';

  const varietyNote = isRegen
    ? '\n\nIMPORTANT: This is a regeneration. Produce 5 completely different thesis ideas — use different leadership theories, different sub-sector angles, different methodologies.'
    : '\n\nAvoid generic topics. Prioritise niche, emerging, counterintuitive angles that would surprise a seasoned academic supervisor.';

  const prompt = `You are a PhD admissions advisor at Chancellor Institute, which delivers executive doctoral programmes in leadership for senior professionals — not full-time academics. Your candidates are typically mid-to-senior executives with 5–20 years of real-world experience.

A prospective PhD candidate works in the "${sector}" sector.

YOUR PRIMARY TASK: ${kwInTitle}${kwSection}

Generate exactly 5 PhD thesis ideas. The ideas must:
1. Be grounded in real, practical leadership challenges that executives actually face
2. Use plain, professional English — NO academic jargon such as "epistemological", "ontological", "hegemonic", "discursive" or similar
3. Be the kind of question a senior leader would genuinely want answered
4. Be researchable part-time over 3–5 years using practitioner methods (interviews, case studies, surveys)

AVOID: feminist theory, critical theory, postcolonial theory, abstract philosophical debates.

GOOD TITLE EXAMPLE: "How do hospital CEOs rebuild staff trust after a major patient safety incident?"
BAD TITLE EXAMPLE: "Challenging the Dualities: A Feminist Critique of Ambidextrous Leadership"

${varietyNote}

Return ONLY valid JSON, no preamble, no markdown:
{"sector":"${sector}","theses":[{"title":"Thesis title directly addressing the research interest","description":"2-3 sentences on the real-world problem, why it matters to practitioners, and how it would be researched.","methodology":"e.g. Interviews with senior executives, case studies","keywords":["kw1","kw2","kw3","kw4"]}]}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You are an expert academic research advisor. Respond with valid JSON only — no markdown, no preamble.' }]
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Gemini error ${response.status}`);
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('Research Compass error:', err.message);
    return new Response(
      JSON.stringify({ error: `Research Compass error: ${err.message}` }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
