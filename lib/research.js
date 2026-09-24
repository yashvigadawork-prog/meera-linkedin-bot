import { config } from './config.js';
import { generateContent, textFromResponse } from './gemini.js';

const BRAND_CONTEXT =
  'Skinstinct is an Indian skincare/cosmetics brand founded by Meera Pillai. ' +
  'Research should be about the skincare/cosmetics industry, dermatology, ' +
  'formulation science, consumer/regulatory news, or a directly related ' +
  "topic - not generic business news unless the fragment is specifically about that.";

// Pulls 3-5 keywords from the note and turns them into one short search
// phrase - a raw voice transcript is a bad search query on its own.
async function extractSearchPhrase(fragment, angle) {
  const prompt =
    `${BRAND_CONTEXT}\n\n` +
    'Read this raw note from Meera and pull out 3 to 5 keywords that ' +
    'capture what it is actually about. Combine them into one short, ' +
    'effective news search phrase (under 8 words). Output ONLY the search ' +
    'phrase, nothing else - no quotes, no explanation, no keyword list. ' +
    'If the note genuinely has no researchable topic (pure opinion or mood ' +
    'with nothing to look up), output nothing.\n\n' +
    `Note:\n"""\n${fragment}\n"""` +
    (angle ? `\n\nSupplied angle:\n"""\n${angle}\n"""` : '');

  // Best-effort step: short timeout, no retry, thinking disabled - this is
  // a cheap extraction task, not worth eating into the budget the actual
  // draft generation needs.
  const data = await generateContent(
    config.geminiDraftModel,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 100,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { timeoutMs: 10000, retries: 0 }
  );
  return textFromResponse(data).replace(/^["']|["']$/g, '').trim();
}

// Google News RSS descriptions come HTML-entity-escaped, and inconsistently
// so - confirmed directly against the raw feed: tags are single-escaped
// (&lt;a href...&gt;) but &nbsp; is double-escaped (&amp;nbsp;). &amp; has
// to decode first to reveal the nested &nbsp;, then the rest, then tags
// get stripped last (stripping first finds nothing, since there are no
// literal < > characters until decoding happens).
function decodeXmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(itemXml, tag) {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

function formatNewsDate(pubDate) {
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return pubDate || '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Google News RSS's <description> is usually just the headline re-wrapped
// in a link, not a real summary - use it only if it adds something beyond
// the title itself, otherwise leave the summary blank rather than fake one.
function extractSummary(itemXml, title) {
  const description = extractTag(itemXml, 'description');
  if (!description || description === title || description.startsWith(title)) return '';
  return description;
}

function parseTopNewsResult(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  if (!items.length) return null;
  const itemXml = items[0];
  const title = extractTag(itemXml, 'title');
  return {
    headline: title,
    source: extractTag(itemXml, 'source'),
    date: formatNewsDate(extractTag(itemXml, 'pubDate')),
    summary: extractSummary(itemXml, title),
    link: extractTag(itemXml, 'link'),
  };
}

async function fetchTopNewsResult(phrase) {
  const url =
    'https://news.google.com/rss/search' +
    `?q=${encodeURIComponent(phrase)}` +
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
  return parseTopNewsResult(xml);
}

// Finds one candidate news item for the drafting step to consider. Never
// throws - a failure here (quota, network, no results) should degrade to
// "no news angle," not break drafting, since this is an enhancement on top
// of Meera's own fragment, not a requirement.
export async function findNewsAngle(fragment, angle) {
  try {
    const phrase = await extractSearchPhrase(fragment, angle);
    if (!phrase) return null;
    return await fetchTopNewsResult(phrase);
  } catch (err) {
    console.error('findNewsAngle failed, continuing without it:', err);
    return null;
  }
}
