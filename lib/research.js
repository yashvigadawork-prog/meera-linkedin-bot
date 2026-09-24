import { config } from './config.js';
import { generateContent, textFromResponse } from './gemini.js';

const BRAND_CONTEXT =
  'Skinstinct is an Indian skincare/cosmetics brand founded by Meera Pillai. ' +
  'Research should be about the skincare/cosmetics industry, dermatology, ' +
  'formulation science, consumer/regulatory news, or a directly related ' +
  "topic - not generic business news unless the fragment is specifically about that.";

const MAX_CANDIDATES = 8;

// Asks Gemini to turn a raw, conversational fragment into a couple of
// actual search queries - a voice transcript ("um so today this customer
// told me...") is a bad query on its own.
async function extractSearchQueries(fragment, angle) {
  const prompt =
    `${BRAND_CONTEXT}\n\n` +
    'Given this raw note from Meera, output 1 to 2 short, effective search ' +
    'queries (each under 8 words) that would find real supporting industry ' +
    'data, research, or news for a LinkedIn post built around this note. ' +
    'Output ONLY the queries, one per line, no numbering, no quotes, no ' +
    'explanation. If the note genuinely has no researchable angle (pure ' +
    'opinion with no topic to look up), output nothing.\n\n' +
    `Note:\n"""\n${fragment}\n"""` +
    (angle ? `\n\nSupplied angle:\n"""\n${angle}\n"""` : '');

  // Best-effort step: short timeout, no retry - if it's slow or fails, skip
  // research entirely rather than eating into the budget the actual draft
  // generation needs.
  const data = await generateContent(
    config.geminiDraftModel,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
    },
    { timeoutMs: 10000, retries: 0 }
  );
  const text = textFromResponse(data);
  return text
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 2);
}

async function googleSearch(query) {
  if (!config.googleSearchApiKey || !config.googleSearchCx) return [];
  const url =
    'https://www.googleapis.com/customsearch/v1' +
    `?key=${encodeURIComponent(config.googleSearchApiKey)}` +
    `&cx=${encodeURIComponent(config.googleSearchCx)}` +
    `&num=4&q=${encodeURIComponent(query)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google Custom Search failed: ${data.error?.message || res.status}`);
  }
  return (data.items || []).map((item) => ({
    type: 'web',
    title: item.title,
    snippet: item.snippet || '',
    source: item.displayLink || '',
    link: item.link,
  }));
}

function decodeXmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTag(itemXml, tag) {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

function parseGoogleNewsRss(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((itemXml) => ({
    type: 'news',
    title: extractTag(itemXml, 'title'),
    source: extractTag(itemXml, 'source'),
    pubDate: extractTag(itemXml, 'pubDate'),
    link: extractTag(itemXml, 'link'),
    snippet: '',
  }));
}

async function googleNewsSearch(query) {
  const url =
    'https://news.google.com/rss/search' +
    `?q=${encodeURIComponent(query)}` +
    `&hl=${config.googleNewsLanguage}-${config.googleNewsRegion}` +
    `&gl=${config.googleNewsRegion}` +
    `&ceid=${config.googleNewsRegion}:${config.googleNewsLanguage}`;

  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Google News RSS failed: ${res.status}`);
  }
  const xml = await res.text();
  return parseGoogleNewsRss(xml).slice(0, 4);
}

// Runs the whole research step. Never throws - a failure here (missing
// keys, quota, network) should degrade to "no research", not break
// drafting, since research is an enhancement on top of Meera's own fragment.
export async function gatherResearch(fragment, angle) {
  try {
    const queries = await extractSearchQueries(fragment, angle);
    if (!queries.length) return [];

    const [webResults, newsResults] = await Promise.all([
      Promise.all(queries.map((q) => googleSearch(q).catch((err) => {
        console.error('googleSearch failed:', err);
        return [];
      }))),
      Promise.all(queries.map((q) => googleNewsSearch(q).catch((err) => {
        console.error('googleNewsSearch failed:', err);
        return [];
      }))),
    ]);

    const combined = [...webResults.flat(), ...newsResults.flat()];
    const seen = new Set();
    const deduped = [];
    for (const candidate of combined) {
      if (!candidate.link || seen.has(candidate.link)) continue;
      seen.add(candidate.link);
      deduped.push(candidate);
    }
    return deduped.slice(0, MAX_CANDIDATES);
  } catch (err) {
    console.error('research gathering failed, continuing without it:', err);
    return [];
  }
}
