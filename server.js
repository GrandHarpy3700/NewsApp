require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const NodeCache = require('node-cache');
const Parser = require('rss-parser');
const basicAuth = require('express-basic-auth');
const terser = require('terser');
const CleanCSS = require('clean-css');

const app = express();
// stdTTL = 5 min; the background warmer below also refreshes proactively.
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });
// og:image cache: persists per article URL for 1 week. Cuts re-fetch cost
// after the first warm — most articles are seen many times.
const ogCache = new NodeCache({ stdTTL: 7 * 24 * 60 * 60, checkperiod: 3600, useClones: false });
const PORT = process.env.PORT || 3000;

// Realistic UA: some news sites block obviously-bot user agents
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'MyNews/1.0 (RSS aggregator)' },
  customFields: {
    item: [
      ['media:content',   'mediaContent',   { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator',      'dcCreator'],
    ],
  },
});

// ── Categories ──
// Each category has 3–6 trusted feeds. The server aggregates them.
const CATEGORIES = {
  global: {
    label: 'Global News', icon: '🌐',
    feeds: [
      { name: 'BBC',        url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
      { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
      { name: 'AP News',    url: 'https://feeds.apnews.com/rss/apf-topnews' },
      { name: 'NPR',        url: 'https://feeds.npr.org/1004/rss.xml' },
      { name: 'Guardian',   url: 'https://www.theguardian.com/world/rss' },
      { name: 'Reuters',    url: 'https://feeds.reuters.com/reuters/topNews' },
    ],
  },
  'south-africa': {
    label: 'South Africa', icon: '🇿🇦',
    feeds: [
      { name: 'Daily Maverick',  url: 'https://www.dailymaverick.co.za/section/south-africa/feed/' },
      { name: 'BusinessTech',    url: 'https://businesstech.co.za/news/feed/' },
      { name: 'The Citizen',     url: 'https://www.citizen.co.za/feed/' },
      { name: 'Mail & Guardian', url: 'https://mg.co.za/feed/' },
      { name: 'News24',          url: 'https://feeds.news24.com/articles/news24/TopStories/rss' },
      { name: 'TimesLive',       url: 'https://www.timeslive.co.za/rss/?publication=times-live&section=news' },
    ],
  },
  politics: {
    label: 'Politics', icon: '🏛️',
    feeds: [
      { name: 'BBC Politics',            url: 'http://feeds.bbci.co.uk/news/politics/rss.xml' },
      { name: 'Daily Maverick Politics', url: 'https://www.dailymaverick.co.za/section/politics/feed/' },
      { name: 'Guardian Politics',       url: 'https://www.theguardian.com/politics/rss' },
      { name: 'NPR Politics',            url: 'https://feeds.npr.org/1014/rss.xml' },
    ],
  },
  economy: {
    label: 'Economy', icon: '💰',
    feeds: [
      { name: 'BBC Business',      url: 'http://feeds.bbci.co.uk/news/business/rss.xml' },
      { name: 'Moneyweb',          url: 'https://www.moneyweb.co.za/feed/' },
      { name: 'BusinessTech',      url: 'https://businesstech.co.za/news/feed/' },
      { name: 'Guardian Business', url: 'https://www.theguardian.com/uk/business/rss' },
    ],
  },
  technology: {
    label: 'Technology', icon: '💻',
    feeds: [
      { name: 'BBC Tech',     url: 'http://feeds.bbci.co.uk/news/technology/rss.xml' },
      { name: 'The Verge',    url: 'https://www.theverge.com/rss/index.xml' },
      { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
      { name: 'TechCrunch',   url: 'https://techcrunch.com/feed/' },
      { name: 'Hacker News',  url: 'https://hnrss.org/frontpage' },
    ],
  },
  sports: {
    label: 'Sports', icon: '⚽',
    feeds: [
      { name: 'BBC Sport',      url: 'http://feeds.bbci.co.uk/sport/rss.xml' },
      { name: 'Guardian Sport', url: 'https://www.theguardian.com/uk/sport/rss' },
      { name: 'Sky Sports',     url: 'https://www.skysports.com/rss/12040' },
      { name: 'CBS Sports',     url: 'https://www.cbssports.com/rss/headlines/' },
      { name: 'Yahoo Sports',   url: 'https://sports.yahoo.com/rss/' },
    ],
  },
  entertainment: {
    label: 'Entertainment', icon: '🎬',
    feeds: [
      { name: 'BBC Entertainment', url: 'http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
      { name: 'Guardian Culture',  url: 'https://www.theguardian.com/culture/rss' },
      { name: 'Variety',           url: 'https://variety.com/feed/' },
    ],
  },
  science: {
    label: 'Science', icon: '🔬',
    feeds: [
      { name: 'BBC Science',      url: 'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
      { name: 'Guardian Science', url: 'https://www.theguardian.com/science/rss' },
      { name: 'NASA',             url: 'https://www.nasa.gov/feed/' },
      { name: 'Sci News',         url: 'http://www.sci-news.com/feed' },
    ],
  },
  health: {
    label: 'Health', icon: '🏥',
    feeds: [
      { name: 'BBC Health',      url: 'http://feeds.bbci.co.uk/news/health/rss.xml' },
      { name: 'Guardian Health', url: 'https://www.theguardian.com/society/health/rss' },
      { name: 'WHO',             url: 'https://www.who.int/rss-feeds/news-english.xml' },
    ],
  },
};

// ── Middleware ──
app.use(cors());
app.use(express.json());

// ── Authentication (HTTP Basic) ──
// Enabled when AUTH_PASS is set in .env. Browser shows a built-in
// login prompt before anything loads — applies to BOTH /api/* and
// the static files in /public, so no part of the app leaks.
const AUTH_USER = process.env.AUTH_USER || 'ruben';
const AUTH_PASS = process.env.AUTH_PASS;
if (AUTH_PASS && AUTH_PASS.length > 0 && AUTH_PASS !== 'disabled') {
  app.use(basicAuth({
    users: { [AUTH_USER]: AUTH_PASS },
    challenge: true,           // makes the browser pop the login dialog
    realm: 'MyNews',
    unauthorizedResponse: { error: 'Unauthorized — please enter your credentials.' },
  }));
  console.log(`🔒 Basic auth ON  (user: ${AUTH_USER})`);
} else {
  console.warn('⚠️  No AUTH_PASS in .env — app is OPEN. Set AUTH_PASS to lock it.');
}

// No-cache headers on everything (we manage caching server-side via NodeCache)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false }));

// ── Helpers ──
function decodeEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { const c = parseInt(h, 16); return c ? String.fromCodePoint(c) : ''; })
    .replace(/&#(\d+);/g,            (_, d) => { const c = parseInt(d, 10); return c ? String.fromCodePoint(c) : ''; })
    .replace(/&amp;/g, '&');  // do this LAST to avoid double-decoding
}
function stripHtml(html) {
  return decodeEntities((html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function truncate(text, max = 280) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max).trim() + '…' : text;
}
// Find the longest plain-text source on a feed item. Some feeds (WordPress-based)
// include the full article in <content:encoded>; others only ship a short snippet.
function longestText(item) {
  const sources = [item.contentEncoded, item.content, item.summary, item.contentSnippet]
    .filter(Boolean)
    .map(stripHtml);
  let best = '';
  for (const s of sources) if (s.length > best.length) best = s;
  return best;
}

// Pick the highest-resolution image from a feed item.
// Many outlets (BBC, Guardian, NPR) include multiple sizes in <media:thumbnail>
// or <media:content>. We pick the biggest; we also rewrite known CDN URLs
// to ask the source for a larger version.
function pickImage(item) {
  const candidates = [];

  // <media:thumbnail width="N" url="..."/> — usually multiple entries
  if (Array.isArray(item.mediaThumbnail)) {
    for (const t of item.mediaThumbnail) {
      const url = t?.$?.url;
      if (url) candidates.push({ url, width: parseInt(t?.$?.width) || 0 });
    }
  }
  // <media:content width="N" url="..."/> — same idea
  if (Array.isArray(item.mediaContent)) {
    for (const c of item.mediaContent) {
      const url = c?.$?.url;
      if (url) candidates.push({ url, width: parseInt(c?.$?.width) || 0 });
    }
  }
  if (item.enclosure?.url) {
    candidates.push({ url: item.enclosure.url, width: 0 });
  }
  // <img> in HTML body — last resort
  const html = item.contentEncoded || item.content || item.summary || '';
  const m = html.match(/<img[^>]+src\s*=\s*["']?([^"'\s>]+)/i);
  if (m) candidates.push({ url: m[1].replace(/&amp;/g, '&'), width: 0 });

  if (candidates.length === 0) return null;

  // Prefer the widest candidate. (Unknown widths sort to the back.)
  candidates.sort((a, b) => b.width - a.width);
  return upgradeImageQuality(candidates[0].url);
}

function upgradeImageQuality(url) {
  if (!url) return url;
  try {
    // BBC News CDN — path-based sizing, no URL signing, safe to rewrite.
    //   https://ichef.bbci.co.uk/news/240/cpsprodpb/AB12/production/_pic.jpg → /976/
    if (/ichef\.bbci\.co\.uk|news\.bbcimg\.co\.uk/i.test(url)) {
      url = url.replace(/\/(\d{2,4})\/(cpsprodpb|cpsprodb|cpsdevpb|production)\//i, '/976/$2/');
    }
    // NPR — _sq- (square crop) → _wide- (better aspect for cards)
    if (/media\.npr\.org/i.test(url)) {
      url = url.replace(/_sq-/g, '_wide-');
    }
    // NOTE: Guardian (i.guim.co.uk) URLs are *signed* — `s=<hash>` validates
    // the rest of the params. Changing width invalidates the signature → 401.
    // We leave Guardian URLs untouched; the `pickImage` sort already grabs
    // the largest variant Guardian's RSS offers.
  } catch (_) { /* ignore */ }
  return url;
}

function estimateReadingMin(fullText) {
  const words = (fullText || '').split(/\s+/).filter(Boolean).length;
  // If the feed only ships a short snippet (typical of BBC, Guardian, Reuters
  // etc.), there's no way to know the real article length — assume a typical
  // 600-word news piece ≈ 3 min.
  if (words < 100) return 3;
  // Otherwise compute from the actual content (≈200 wpm reading speed).
  return Math.max(2, Math.min(30, Math.round(words / 200)));
}

// Fetch the og:image / twitter:image meta tag from an article's HTML.
// Cached for 1 week — subsequent calls for the same URL are instant.
async function fetchOgImage(articleUrl) {
  if (!articleUrl) return null;
  const cached = ogCache.get(articleUrl);
  if (cached !== undefined) return cached;   // null = "checked, none found"

  let img = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(articleUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':      BROWSER_UA,
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(t);
    if (res.ok) {
      const html = await res.text();
      const patterns = [
        /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
        /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) { img = m[1].replace(/&amp;/g, '&'); break; }
      }
    }
  } catch (_) { /* timeout / network error */ }

  ogCache.set(articleUrl, img);  // remember even null
  return img;
}

// Fill in urlToImage on articles that don't already have one, in parallel batches.
// Mutates the array in place so the cached reference picks up the new images.
async function enrichMissingImages(articles, maxToEnrich = 40) {
  const missing = articles.filter(a => !a.urlToImage && a.url).slice(0, maxToEnrich);
  if (missing.length === 0) return;
  const CONCURRENCY = 6;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(a => fetchOgImage(a.url)));
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) batch[j].urlToImage = results[j];
    }
  }
}

async function fetchOneFeed(feedUrl, sourceName) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return (feed.items || []).map((item) => {
      // Two passes: full text → reading time, short snippet → description.
      const full = longestText(item);
      const snippet = truncate(stripHtml(item.contentSnippet || item.summary || item.content || item.contentEncoded || ''), 280);
      return {
        title:        decodeEntities(item.title || '(untitled)'),
        description:  snippet,
        url:          item.link,
        urlToImage:   pickImage(item),
        publishedAt:  item.isoDate || item.pubDate || new Date().toISOString(),
        source:       { name: sourceName },
        author:       item.creator || item.dcCreator || item.author || null,
        readingMin:   estimateReadingMin(full),
      };
    });
  } catch (e) {
    console.warn(`[feed:${sourceName}] ${e.message}`);
    return [];
  }
}

async function fetchCategory(categoryId) {
  const cat = CATEGORIES[categoryId];
  if (!cat) return null;
  const results = await Promise.all(cat.feeds.map((f) => fetchOneFeed(f.url, f.name)));
  const merged = results.flat();
  // newest first
  merged.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  // dedupe by URL
  const seen = new Set();
  return merged.filter((a) => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

// ── API ──
app.get('/api/status', (_req, res) => {
  res.json({
    ready: true,
    categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, icon: c.icon })),
  });
});

app.get('/api/categories', (_req, res) => {
  res.json(
    Object.entries(CATEGORIES).map(([id, c]) => ({
      id, label: c.label, icon: c.icon,
      sources: c.feeds.map((f) => f.name),
    }))
  );
});

app.get('/api/feeds/:category', async (req, res) => {
  const { category } = req.params;
  if (!CATEGORIES[category]) return res.status(404).json({ error: 'Unknown category' });

  const cacheKey = `feeds:${category}`;
  const force = req.query.force === '1';

  // Normal path: serve from cache when available.
  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit) {
      const articles = Array.isArray(hit) ? hit : hit.articles;
      const fetchedAt = Array.isArray(hit) ? Date.now() : hit.fetchedAt;
      return res.json({
        articles,
        fromCache:     true,
        category,
        categoryLabel: CATEGORIES[category].label,
        fetchedAt:     new Date(fetchedAt).toISOString(),
      });
    }
  }

  // Either cache miss or client requested ?force=1 — fetch RSS fresh.
  try {
    const articles = await fetchCategory(category);
    const entry = { articles, fetchedAt: Date.now() };
    cache.set(cacheKey, entry);
    res.json({
      articles,
      fromCache:     false,
      forced:        force,
      category,
      categoryLabel: CATEGORIES[category].label,
      fetchedAt:     new Date(entry.fetchedAt).toISOString(),
    });
    // Fire-and-forget: backfill missing images after the response is sent.
    enrichMissingImages(articles, 40).catch(() => {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Server-side search across cached categories.
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.status(400).json({ error: 'Query must be at least 2 characters' });
  const all = [];
  for (const id of Object.keys(CATEGORIES)) {
    const entry = cache.get(`feeds:${id}`);
    const items = Array.isArray(entry) ? entry : entry?.articles;
    if (Array.isArray(items)) all.push(...items);
  }
  const seen = new Set();
  const matches = all
    .filter((a) =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.source?.name || '').toLowerCase().includes(q)
    )
    .filter((a) => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
  matches.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  res.json({ articles: matches, query: q, totalResults: matches.length, fetchedAt: new Date().toISOString() });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Cache warmer (runs at boot + every 5 min) ──
// Two-phase: 1) RSS-only cache fills in seconds.  2) og:image enrichment runs
// in the background, mutating the cached arrays in place so missing pictures
// progressively fill in.  We cache by reference (useClones:false) so the
// in-place mutations are visible to subsequent /api/feeds/:cat requests.
let warming = false;
async function warmCache() {
  if (warming) return;
  warming = true;
  const start = Date.now();

  // PHASE 1 — RSS only.  Quick, gets the cache full of articles.
  const allArticles = {};
  await Promise.all(
    Object.keys(CATEGORIES).map(async (id) => {
      try {
        const articles = await fetchCategory(id);
        // New cache shape carries the actual fetch time so clients can show
        // "Updated 2 min ago" instead of just the render time.
        cache.set(`feeds:${id}`, { articles, fetchedAt: Date.now() });
        allArticles[id] = articles;
        const withImg = articles.filter(a => a.urlToImage).length;
        console.log(`  ${id.padEnd(14)} ${String(articles.length).padStart(3)} articles (${withImg} w/img)`);
      } catch (e) {
        console.warn(`  ${id} FAILED: ${e.message}`);
      }
    })
  );
  console.log(`[warm] RSS phase done in ${Date.now() - start}ms — enriching images in background…`);
  warming = false;

  // PHASE 2 — fire-and-forget og:image enrichment for any article without an image.
  // Categories enrich in parallel; first 40 missing per category get filled.
  for (const id of Object.keys(allArticles)) {
    enrichMissingImages(allArticles[id], 40)
      .then(() => {
        const after = allArticles[id].filter(a => a.urlToImage).length;
        console.log(`[enrich] ${id.padEnd(14)} → ${after}/${allArticles[id].length} w/img`);
      })
      .catch(() => {});
  }
}

// ── Build step: minify readable source files (/src/) into /public/ ──
// Visitors who press F12 see scrambled gibberish; you keep the clean
// readable version in /src/ which the server never exposes.
async function buildAssets() {
  const SRC = path.join(__dirname, 'src');
  const DST = path.join(__dirname, 'public');
  if (!fs.existsSync(SRC)) {
    console.warn('[build] /src/ not found — skipping minification');
    return;
  }

  const tasks = [];

  // app.js — minify + mangle (rename variables to single letters)
  const jsSrc = path.join(SRC, 'app.js');
  if (fs.existsSync(jsSrc)) {
    tasks.push((async () => {
      try {
        const code = fs.readFileSync(jsSrc, 'utf8');
        const out = await terser.minify(code, {
          mangle: { toplevel: true },
          compress: { passes: 2, drop_console: false },
          format:   { comments: false },
        });
        if (out.code) {
          fs.writeFileSync(path.join(DST, 'app.js'), out.code);
          console.log(`[build] app.js   ${code.length} → ${out.code.length} bytes`);
        }
      } catch (e) { console.warn('[build] app.js failed:', e.message); }
    })());
  }

  // sw.js
  const swSrc = path.join(SRC, 'sw.js');
  if (fs.existsSync(swSrc)) {
    tasks.push((async () => {
      try {
        const code = fs.readFileSync(swSrc, 'utf8');
        const out = await terser.minify(code, {
          mangle: true,
          compress: true,
          format: { comments: false },
        });
        if (out.code) {
          fs.writeFileSync(path.join(DST, 'sw.js'), out.code);
          console.log(`[build] sw.js    ${code.length} → ${out.code.length} bytes`);
        }
      } catch (e) { console.warn('[build] sw.js failed:', e.message); }
    })());
  }

  // style.css
  const cssSrc = path.join(SRC, 'style.css');
  if (fs.existsSync(cssSrc)) {
    try {
      const code = fs.readFileSync(cssSrc, 'utf8');
      const out = new CleanCSS({ level: 2 }).minify(code);
      if (out.styles) {
        fs.writeFileSync(path.join(DST, 'style.css'), out.styles);
        console.log(`[build] style.css ${code.length} → ${out.styles.length} bytes`);
      }
    } catch (e) { console.warn('[build] style.css failed:', e.message); }
  }

  await Promise.all(tasks);
}

app.listen(PORT, async () => {
  console.log('\n📰  MyNews server: http://localhost:' + PORT);
  console.log('[build] minifying /src/ → /public/');
  await buildAssets();
  console.log('[warm] starting initial cache warm...');
  warmCache();
  setInterval(warmCache, 5 * 60 * 1000);
});
