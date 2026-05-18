'use strict';

// ──────────────────────────────────────────────────────────
//  MyNews — front-end app
//  • Hits the local Express server's /api/feeds/:category (fast, cached, deduped)
//  • Falls back to rss2json.com if the server isn't reachable (for static PWA hosting)
//  • Bookmarks, read tracking, share, reading time, pre-warming
// ──────────────────────────────────────────────────────────

// ─── i18n: English + Afrikaans ─────────────────────────────────
const I18N = {
  en: {
    sidebar:    { liveFeed: 'Live Feed', categories: 'Categories', darkMode: 'Dark Mode', lightMode: 'Light Mode', footer: 'Powered by RSS' },
    categories: { 'global':'Global News','south-africa':'South Africa','politics':'Politics','economy':'Economy','technology':'Technology','sports':'Sports','entertainment':'Entertainment','science':'Science','health':'Health','__saved__':'Saved','__home__':'Home' },
    search:     { placeholder: 'Search any topic…', button: 'Search', recentSearches: 'Recent searches', clearAll: 'Clear all', label: 'Search' },
    card:       { readArticle: 'Read article', read: '✓ Read', minRead: 'min read', breaking: 'Breaking', new: 'New' },
    stats:      { articles: 'articles', loading: 'Loading news…', updated: 'Updated', justNow: 'just now', lessThanMinAgo: '<1 min ago', minAgo: 'min ago', hAgo: 'h ago' },
    states:     {
      noResultsTitle: 'No articles found',
      noResultsSearch: (q) => `No articles found for "${q}". Try a different keyword — news feeds only cover current events from the past few days.`,
      noArticles:     'No articles available right now. Try the Refresh button.',
      nothingSaved:   'Nothing saved yet. Tap the ★ on any article to save it for later.',
      noHomePrefs:    'Pick your topics to start seeing personalized news here.',
      chooseTopics:   'Choose your topics',
      errorTitle:     "Couldn't load news",
      errorMsg:       'Please check your connection and try again.',
      retry:          'Try Again',
      loadMore:       'Load More Stories',
      loadingMore:    'Loading…',
      savedArticles:  (n) => `${n} saved article${n === 1 ? '' : 's'}`,
      sources:        'sources',
    },
    toasts:    { saved: '★ Saved', removed: 'Removed from Saved', updated: 'Updated', linkCopied: 'Link copied to clipboard', languageChanged: 'Language switched' },
    shortcuts: { title: 'Keyboard Shortcuts' },
  },
};

const API_BASE = '/api'; // Root path for the app's local backend API
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url='; // Public RSS-to-JSON proxy for fallback fetching
const FEED_TIMEOUT_MS = 6000; // Timeout for each individual RSS feed request
const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache lifetime for category data in sessionStorage
const OG_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days cache life for og:image lookups
const OG_IMAGE_CONCURRENCY = 8; // Max concurrent og:image fetches to avoid overload
const PAGE_SIZE = 30; // Number of articles shown per page/load-more batch

// Fallback list (used only if server unreachable, e.g. deployed-PWA mode)
const FALLBACK_CATEGORIES = [
  { id: 'global',        label: 'Global News',   icon: '🌐', feeds: [
    { name: 'BBC',         url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Al Jazeera',  url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'Guardian',    url: 'https://www.theguardian.com/world/rss' },
    { name: 'NPR',         url: 'https://feeds.npr.org/1004/rss.xml' },
  ]},
  { id: 'south-africa',  label: 'South Africa',  icon: '🇿🇦', feeds: [
    { name: 'BusinessTech',    url: 'https://businesstech.co.za/news/feed/' },
    { name: 'The Citizen',     url: 'https://www.citizen.co.za/feed/' },
    { name: 'Mail & Guardian', url: 'https://mg.co.za/feed/' },
  ]},
  { id: 'politics',      label: 'Politics',      icon: '🏛️', feeds: [
    { name: 'BBC Politics',      url: 'http://feeds.bbci.co.uk/news/politics/rss.xml' },
    { name: 'Guardian Politics', url: 'https://www.theguardian.com/politics/rss' },
  ]},
  { id: 'economy',       label: 'Economy',       icon: '💰', feeds: [
    { name: 'BBC Business',  url: 'http://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'BusinessTech',  url: 'https://businesstech.co.za/news/feed/' },
    { name: 'Moneyweb',      url: 'https://www.moneyweb.co.za/feed/' },
  ]},
  { id: 'technology',    label: 'Technology',    icon: '💻', feeds: [
    { name: 'The Verge',    url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'TechCrunch',   url: 'https://techcrunch.com/feed/' },
    { name: 'Hacker News',  url: 'https://hnrss.org/frontpage' },
  ]},
  { id: 'sports',        label: 'Sports',        icon: '⚽', feeds: [
    { name: 'BBC Sport',      url: 'http://feeds.bbci.co.uk/sport/rss.xml' },
    { name: 'Guardian Sport', url: 'https://www.theguardian.com/uk/sport/rss' },
  ]},
  { id: 'entertainment', label: 'Entertainment', icon: '🎬', feeds: [
    { name: 'BBC Entertainment', url: 'http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
    { name: 'Guardian Culture',  url: 'https://www.theguardian.com/culture/rss' },
    { name: 'Variety',           url: 'https://variety.com/feed/' },
  ]},
  { id: 'science',       label: 'Science',       icon: '🔬', feeds: [
    { name: 'BBC Science',      url: 'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
    { name: 'Guardian Science', url: 'https://www.theguardian.com/science/rss' },
    { name: 'NASA',             url: 'https://www.nasa.gov/feed/' },
  ]},
  { id: 'health',        label: 'Health',        icon: '🏥', feeds: [
    { name: 'BBC Health',      url: 'http://feeds.bbci.co.uk/news/health/rss.xml' },
    { name: 'Guardian Health', url: 'https://www.theguardian.com/society/health/rss' },
  ]},
];

// ── Persistent stores (localStorage) ──
const Bookmarks = {
  KEY: 'mynews:bookmarks', // Storage key for saved articles
  _cache: null, // In-memory cache to avoid repeated JSON parsing
  _load() {
    if (this._cache) return this._cache; // return cached list if available
    try { this._cache = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { this._cache = []; }
    return this._cache;
  },
  all() { return [...this._load()]; }, // Return a copy of all saved articles
  has(url) { return this._load().some(a => a.url === url); }, // Check if a URL is bookmarked
  add(article) {
    const list = this._load();
    if (list.some(a => a.url === article.url)) return; // avoid duplicates
    list.unshift({ ...article, bookmarkedAt: Date.now() }); // newest first
    this._cache = list;
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch {}
  },
  remove(url) {
    const list = this._load().filter(a => a.url !== url); // drop matching article
    this._cache = list;
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch {}
  },
  toggle(article) {
    if (this.has(article.url)) { this.remove(article.url); return false; }
    this.add(article); return true; // add if not present, remove if present
  },
};

// ── Topic preferences for the Home feed ──
// Each preference points to ONE category and may filter that category's articles
// by an includeRe (must match) and/or excludeRe (must not match) regex run on
// title + description.  Home merges all selected preferences into one feed.
const PREFERENCES = [
  { id: 'sa-news',         label: 'South African News',     emoji: '🇿🇦', category: 'south-africa' },
  { id: 'global-news',     label: 'Global News',            emoji: '🌍', category: 'global' },
  { id: 'sa-politics',     label: 'South African Politics', emoji: '🗳️', category: 'politics',
    includeRe: /\b(south africa|south african|ramaphosa|anc|eff|da\b|gnu|parliament|gauteng|cape town|johannesburg|durban|pretoria|mk party)\b/i },
  { id: 'global-politics', label: 'Global Politics',        emoji: '🏛️', category: 'politics',
    excludeRe: /\b(south africa|south african|ramaphosa|gauteng|cape town|johannesburg|durban|pretoria|mk party)\b/i },
  { id: 'sports',          label: 'Sports',                 emoji: '⚽', category: 'sports' },
  { id: 'science',         label: 'Science',                emoji: '🔬', category: 'science' },
  { id: 'films-series',    label: 'Films & Series',         emoji: '🎬', category: 'entertainment',
    includeRe: /\b(film|movie|series|show|streaming|netflix|disney|hbo|prime video|hulu|cinema|trailer|premiere|episode|season|spinoff|reboot|sequel|director)\b/i },
  { id: 'actors',          label: 'Actors',                 emoji: '🎭', category: 'entertainment',
    includeRe: /\b(actor|actress|stars? in|starring|cast as|portrays|leading role)\b/i },
  { id: 'artists',         label: 'Artists',                emoji: '🎵', category: 'entertainment',
    includeRe: /\b(singer|musician|band|album|song|tour|concert|grammys?|billboard|spotify|playlist|hit single|rapper|pop star)\b/i },
];

const PrefStore = {
  KEY: 'mynews:prefs', // Storage key for selected Home feed preferences
  ONBOARDED_KEY: 'mynews:onboarded', // Storage key for first-run onboarding state
  _cache: null, // In-memory copy of selected preference IDs
  load() {
    if (this._cache) return this._cache;
    try { this._cache = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { this._cache = []; }
    return this._cache;
  },
  save(ids) {
    this._cache = [...new Set(ids)]; // dedupe preference IDs
    try { localStorage.setItem(this.KEY, JSON.stringify(this._cache)); } catch {}
  },
  hasOnboarded() {
    try { return localStorage.getItem(this.ONBOARDED_KEY) === '1'; }
    catch { return false; }
  },
  setOnboarded(v = true) {
    try { localStorage.setItem(this.ONBOARDED_KEY, v ? '1' : '0'); } catch {}
  },
  hasAny() { return this.load().length > 0; }, // true if the user selected any preferences
};

// ── Persistent: recent searches (max 8, newest first) ──
const RecentSearches = {
  KEY: 'mynews:recent-searches', // Storage key for recent search terms
  MAX: 8, // Keep at most 8 recent search items
  all() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { return []; }
  },
  add(q) {
    if (!q || q.length < 2) return; // ignore empty or one-character queries
    let list = this.all().filter(x => x !== q); // remove duplicates
    list.unshift(q); // newest first
    list = list.slice(0, this.MAX); // enforce max size
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch {}
  },
  remove(q) {
    const list = this.all().filter(x => x !== q);
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch {}
  },
  clear() { try { localStorage.removeItem(this.KEY); } catch {} }, // clear history
};

const ReadTracker = {
  KEY: 'mynews:read', // Storage key for URLs marked as read
  MAX: 1000, // Keep only the last 1000 read URLs
  _cache: null,
  _load() {
    if (this._cache) return this._cache;
    try { this._cache = new Set(JSON.parse(localStorage.getItem(this.KEY) || '[]')); }
    catch { this._cache = new Set(); }
    return this._cache;
  },
  isRead(url) { return this._load().has(url); }, // Check if article has been read
  markRead(url) {
    const set = this._load();
    if (set.has(url)) return; // already marked read
    set.add(url);
    let arr = [...set];
    if (arr.length > this.MAX) arr = arr.slice(-this.MAX); // trim oldest if needed
    this._cache = new Set(arr);
    try { localStorage.setItem(this.KEY, JSON.stringify(arr)); } catch {}
  },
};

// ────────────────────────────────────────────────────────────
class NewsApp {
  constructor() {
    this.lang = 'en';                                       // English-only UI
    document.documentElement.setAttribute('lang', this.lang); // Set HTML language attribute
    // Default to Home if the user has any preferences saved, else Global.
    this.category = PrefStore.hasAny() ? '__home__' : 'global';
    this.allArticles = []; // currently loaded article list
    this.totalResults = 0; // total articles available for current query/category
    this.shownCount = 0; // articles already rendered to the page
    this.loading = false; // whether a load operation is in progress
    this._loadReqId = 0; // request counter to ignore stale responses
    this.searchMode = false; // whether current view is search results
    this.searchQuery = ''; // current search query text
    this.savedMode = false; // whether current view is saved/bookmarked articles
    this.categories = FALLBACK_CATEGORIES; // category metadata fallback list
    this.serverAvailable = null; // unknown until first probe
    this.refreshSeconds = 300; // countdown until next auto-refresh
    this.refreshTimer = null; // refresh interval handle
    this.imgObserver = null; // IntersectionObserver for lazy og:image loading
    this._ogActive = 0; // count of active og:image fetches

    this.$ = (id) => document.getElementById(id); // shorthand DOM lookup
    this.els = {
      navList:        this.$('navList'),
      headerTitle:    this.$('headerTitle'),
      searchForm:     this.$('searchForm'),
      searchInput:    this.$('searchInput'),
      newsGrid:       this.$('newsGrid'),
      skeletonGrid:   this.$('skeletonGrid'),
      errorState:     this.$('errorState'),
      errorTitle:     this.$('errorTitle'),
      errorMsg:       this.$('errorMsg'),
      emptyState:     this.$('emptyState'),
      emptyMsg:       this.$('emptyMsg'),
      statsText:      this.$('statsText'),
      fetchTime:      this.$('fetchTime'),
      loadMoreWrap:   this.$('loadMoreWrap'),
      loadMoreBtn:    this.$('loadMoreBtn'),
      tickerWrap:     this.$('tickerWrap'),
      tickerTrack:    this.$('tickerTrack'),
      themeBtn:       this.$('themeBtn'),
      themeIcon:      this.$('themeBtn').querySelector('.theme-icon'),
      themeText:      this.$('themeBtn').querySelector('.theme-text'),
      timerText:      this.$('timerText'),
      refreshNowBtn:  this.$('refreshNowBtn'),
      menuBtn:        this.$('menuBtn'),
      sidebar:        this.$('sidebar'),
      sidebarClose:   this.$('sidebarClose'),
      overlay:        this.$('overlay'),
    };

    this.init(); // Start app initialization
  }

  async init() {
    this.applyStoredTheme(); // restore previously selected light/dark theme
    this.bindEvents(); // wire UI events once at startup
    this.setupPullToRefresh(); // enable touch pull-to-refresh on mobile
    this.setupScrollToTop(); // enable floating scroll-to-top button
    // Try to load category metadata from server (gives us the canonical list).
    await this.loadCategoryMetadata();
    this.renderNav(); // render sidebar/category navigation
    // First-run: show the preferences picker BEFORE loading news.
    if (!PrefStore.hasOnboarded()) {
      this.openOnboarding(true);
    }
    this.loadNews(); // initial news load
    this.startRefreshTimer(); // auto-refresh countdown
    // Pre-warm OTHER categories in the background so switching is instant.
    setTimeout(() => this.prewarmOtherCategories(), 1500);
    // Tick the "Updated X min ago" label every 30s so it counts up while idle.
    setInterval(() => {
      if (!this.savedMode && this._lastFetchedAt) this.refreshFetchTimeLabel();
    }, 30_000);
  }

  // ── Scroll-to-top button ──
  // Floats at the bottom-right; appears after ~400 px of scroll, fades out at the top.
  setupScrollToTop() {
    const btn = this.$('scrollTopBtn');
    if (!btn) return;
    const THRESHOLD = 400;
    let ticking = false;

    const update = () => {
      if (window.scrollY > THRESHOLD) btn.classList.add('visible');
      else btn.classList.remove('visible');
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });

    btn.addEventListener('click', () => {
      // Smooth scroll. If the browser doesn't support smooth behavior, falls back to instant.
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (_) {
        window.scrollTo(0, 0);
      }
    });
  }

  // Translation helper — kept dormant for now; always returns English.
  t(section, key, ...args) {
    const v = I18N.en?.[section]?.[key];
    return typeof v === 'function' ? v(...args) : (v ?? '');
  }

  // ── Onboarding (first-run preferences picker) ──
  openOnboarding(isFirstRun = false) {
    const overlay = this.$('onboardingOverlay');
    const grid = this.$('onboardingGrid');
    if (!overlay || !grid) return;
    const selected = new Set(PrefStore.load());

    grid.innerHTML = PREFERENCES.map(p => `
      <button class="pref-chip${selected.has(p.id) ? ' selected' : ''}" data-pref="${p.id}" type="button">
        <span class="pref-chip-emoji">${p.emoji}</span>
        <span>${this.escHtml(p.label)}</span>
      </button>
    `).join('');

    grid.querySelectorAll('.pref-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pref;
        if (selected.has(id)) { selected.delete(id); btn.classList.remove('selected'); }
        else { selected.add(id); btn.classList.add('selected'); }
      });
    });

    const skipBtn = this.$('onboardingSkip');
    const confirmBtn = this.$('onboardingConfirm');
    skipBtn.textContent = isFirstRun ? 'Skip for now' : 'Cancel';
    confirmBtn.textContent = isFirstRun ? 'Done' : 'Save';

    // Replace listeners (idempotent re-open)
    const skip = () => {
      PrefStore.setOnboarded(true);
      this.closeOnboarding();
    };
    const confirm = () => {
      PrefStore.save([...selected]);
      PrefStore.setOnboarded(true);
      this.closeOnboarding();
      this.renderNav();
      // After saving prefs, jump straight to Home so the user sees the result.
      this.openHome();
      this.toast(selected.size > 0 ? `Saved ${selected.size} topic${selected.size === 1 ? '' : 's'}` : 'Preferences cleared', 'success');
    };
    skipBtn.onclick = skip;
    confirmBtn.onclick = confirm;
    overlay.hidden = false;
  }
  closeOnboarding() {
    const overlay = this.$('onboardingOverlay');
    if (overlay) overlay.hidden = true;
  }
  addHomeCustomizeButton() {
    // Adds a "Choose your topics" call-to-action inside the empty-state.
    if (this.$('homeCustomizeBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'homeCustomizeBtn';
    btn.className = 'home-cta';
    btn.type = 'button';
    btn.textContent = this.t('states', 'chooseTopics');
    btn.addEventListener('click', () => this.openOnboarding(false));
    this.els.emptyState.appendChild(btn);
  }

  // ── Pull-to-refresh (touch-only, no-op on desktop) ──
  setupPullToRefresh() {
    // Only wire up on touch devices
    if (!('ontouchstart' in window)) return;

    let startY = 0;
    let pulling = false;
    let active = false;       // user is actively pulling past threshold
    const THRESHOLD = 80;
    const MAX_PULL = 140;

    // Indicator element
    const ind = document.createElement('div');
    ind.className = 'ptr-indicator';
    ind.textContent = '↓';
    document.body.appendChild(ind);

    document.addEventListener('touchstart', (e) => {
      // Only engage if user is at the very top of scroll
      if (window.scrollY > 0) { pulling = false; return; }
      startY = e.touches[0].clientY;
      pulling = true;
      active = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        ind.classList.remove('visible', 'ready');
        ind.style.transform = '';
        return;
      }
      const distance = Math.min(MAX_PULL, dy);
      // Map distance → translateY (eased)
      const ty = -60 + Math.min(80, distance * 0.7);
      ind.style.transform = `translateY(${ty}px)`;
      ind.classList.add('visible');
      if (distance >= THRESHOLD) {
        ind.classList.add('ready');
        ind.textContent = '↻';
        active = true;
      } else {
        ind.classList.remove('ready');
        ind.textContent = '↓';
        active = false;
      }
    }, { passive: true });

    const endPull = () => {
      if (!pulling) return;
      pulling = false;
      if (active) {
        ind.classList.add('refreshing');
        ind.classList.remove('ready');
        ind.textContent = '↻';
        this.loadNews(false, true);   // force-fresh
        setTimeout(() => {
          ind.classList.remove('refreshing', 'visible');
          ind.style.transform = '';
          ind.textContent = '↓';
        }, 900);
      } else {
        ind.classList.remove('visible', 'ready');
        ind.style.transform = '';
        ind.textContent = '↓';
      }
      active = false;
    };
    document.addEventListener('touchend',    endPull, { passive: true });
    document.addEventListener('touchcancel', endPull, { passive: true });
  }

  // ── Category metadata ──
  async loadCategoryMetadata() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000); // fail fast after 3 seconds
      const res = await fetch(`${API_BASE}/categories`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('not ok');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Merge: keep feed URLs from FALLBACK (for rss2json fallback), add server-provided label/icon/sources
        this.categories = data.map(serverCat => {
          const fb = FALLBACK_CATEGORIES.find(c => c.id === serverCat.id);
          return { ...serverCat, feeds: fb ? fb.feeds : [] };
        });
        this.serverAvailable = true; // mark server as reachable
      }
    } catch (_) {
      this.serverAvailable = false; // fallback to client RSS sources
      // keep this.categories = FALLBACK_CATEGORIES
    }
  }

  // ── Cache helpers (stale-while-revalidate via sessionStorage) ──
  cacheGet(key, ttlMs = CATEGORY_CACHE_TTL_MS) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > ttlMs) return null; // expired
      return data;
    } catch { return null; }
  }
  cacheGetAny(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw).data;
    } catch { return null; }
  }
  cacheSet(key, data) {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); }
    catch {}
  }

  // ── Fetch a category — server first, rss2json fallback ──
  async fetchCategoryFromServer(catId, force = false) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000); // allow enough time for server response
    try {
      const qs = force ? '?force=1' : '';
      const res = await fetch(`${API_BASE}/feeds/${encodeURIComponent(catId)}${qs}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data.articles)) return null;
      // Remember when the server says the data was fetched (so "Updated X min ago" is honest).
      if (data.fetchedAt) this._lastFetchedAt = new Date(data.fetchedAt).getTime();
      return data.articles;
    } catch {
      clearTimeout(t);
      return null; // server fetch failed
    }
  }

  async fetchCategoryFromRss2Json(catId) {
    const cat = this.categories.find(c => c.id === catId);
    if (!cat || !cat.feeds) return [];
    const fetchOne = async (feed) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
      try {
        const res = await fetch(RSS2JSON + encodeURIComponent(feed.url), { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return [];
        const data = await res.json();
        if (data.status !== 'ok' || !Array.isArray(data.items)) return [];
        return data.items.map(item => ({
          title:       item.title || '(untitled)',
          description: this.stripHtml(item.description || ''),
          url:         item.link,
          urlToImage:  this.pickThumbnail(item),
          publishedAt: item.pubDate,
          source:      { name: feed.name },
          author:      item.author || null,
          readingMin:  this.estimateReadingMin(item.description),
        }));
      } catch { clearTimeout(t); return []; }
    };
    const results = await Promise.all(cat.feeds.map(fetchOne));
    const merged = results.flat();
    merged.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const seen = new Set();
    return merged.filter(a => {
      if (!a.url || seen.has(a.url)) return false; // remove duplicates and invalid items
      seen.add(a.url);
      return true;
    });
  }

  async fetchAllForCategory(catId, force = false) {
    // Home is special: aggregate articles from every selected preference.
    if (catId === '__home__') return this.fetchHomeFeed(force);

    // Server first (fast), rss2json fallback (only if server unreachable)
    if (this.serverAvailable !== false) {
      const items = await this.fetchCategoryFromServer(catId, force);
      if (items) { this.serverAvailable = true; return items; }
      this.serverAvailable = false;
    }
    return this.fetchCategoryFromRss2Json(catId);
  }

  // Build a personalized Home feed from the user's selected preferences.
  // For each pref: fetch its underlying category, apply include/exclude
  // regex on title+description, then merge + dedupe + sort by date.
  async fetchHomeFeed(force = false) {
    const ids = PrefStore.load(); // loaded preference IDs
    if (ids.length === 0) return [];
    const prefs = ids.map(id => PREFERENCES.find(p => p.id === id)).filter(Boolean);
    if (prefs.length === 0) return [];

    // Fetch each underlying category once (deduped across prefs that share one)
    const neededCats = [...new Set(prefs.map(p => p.category))];
    const catData = {};
    await Promise.all(neededCats.map(async (cat) => {
      catData[cat] = await this.fetchCategoryFromServer(cat, force) || [];
    }));

    const matchesPref = (article, pref) => {
      if (!pref.includeRe && !pref.excludeRe) return true;
      const hay = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
      if (pref.excludeRe && pref.excludeRe.test(hay)) return false;
      if (pref.includeRe && !pref.includeRe.test(hay)) return false;
      return true;
    };

    const merged = [];
    for (const pref of prefs) {
      const articles = catData[pref.category] || [];
      for (const a of articles) {
        if (matchesPref(a, pref)) merged.push(a);
      }
    }

    // Dedupe by URL (an article might match multiple prefs)
    const seen = new Set();
    const deduped = merged.filter(a => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // Newest first
    deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Mark fetched-at now (Home is a fresh aggregation)
    this._lastFetchedAt = Date.now();
    return deduped;
  }

  async searchAll(query) {
    // Try server search (uses its cached articles) — instant
    if (this.serverAvailable !== false) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.articles)) {
            if (data.fetchedAt) this._lastFetchedAt = new Date(data.fetchedAt).getTime();
            return data.articles;
          }
        }
      } catch {}
    }
    // Fallback path doesn't fetch — uses already-cached data, so call it fresh now.
    this._lastFetchedAt = Date.now();
    // Fallback: search across cached categories client-side
    const q = query.toLowerCase();
    const merged = [];
    for (const c of this.categories) {
      const cached = this.cacheGetAny(`cat:${c.id}`);
      if (cached) merged.push(...cached);
    }
    const filtered = merged.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.source?.name || '').toLowerCase().includes(q)
    );
    filtered.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const seen = new Set();
    return filtered.filter(a => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
  }

  // ── Background pre-warming ──
  async prewarmOtherCategories() {
    if (this.serverAvailable === false) return; // not worth it on rss2json fallback
    const ids = this.categories.map(c => c.id).filter(id => id !== this.category);
    // Sequentially with small delay so the server isn't hammered
    for (const id of ids) {
      const fresh = this.cacheGet(`cat:${id}`);
      if (fresh) continue;
      try {
        const items = await this.fetchCategoryFromServer(id);
        if (items) this.cacheSet(`cat:${id}`, items);
      } catch {}
      await new Promise(r => setTimeout(r, 80));
    }
  }

  // ── Nav rendering ──
  renderNav() {
    const items = [
      { id: '__home__',  icon: '🏠', isSpecial: true },
      { id: '__saved__', icon: '⭐', count: Bookmarks.all().length, isSpecial: true },
      ...this.categories,
    ];
    this.els.navList.innerHTML = items.map(c => {
      const isActive = (c.id === '__saved__' && this.savedMode) || (!this.savedMode && c.id === this.category);
      const label = this.t('categories', c.id) || c.label || c.id;
      const badge = c.id === '__saved__' && c.count > 0 ? `<span class="nav-badge">${c.count}</span>` : '';
      return `
        <li>
          <button class="nav-item${isActive ? ' active' : ''}" data-category="${c.id}" aria-current="${isActive ? 'page' : 'false'}">
            <span class="icon">${c.icon}</span>
            <span class="nav-label-text">${this.escHtml(label)}</span>
            ${badge}
          </button>
        </li>
      `;
    }).join('');

    this.els.navList.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.category;
        if (id === '__saved__')      this.openSaved();
        else if (id === '__home__')  this.openHome();
        else                         this.selectCategory(id);
        this.closeSidebar();
      });
    });
  }

  selectCategory(id) {
    if (this.category === id && !this.searchMode && !this.savedMode) return;
    this.category = id;
    this.searchMode = false;
    this.savedMode = false;
    this.searchQuery = '';
    this.els.searchInput.value = '';
    this.updateNavActive();
    this.els.headerTitle.textContent = this.t('categories', id) || id;
    this.loadNews();
  }

  openHome() {
    // Clicking Home a SECOND time (while already in Home) re-opens the
    // preferences picker — gives the user an easy way to edit their topics.
    if (this.category === '__home__' && !this.searchMode && !this.savedMode) {
      this.openOnboarding(false);
      return;
    }
    this.category = '__home__';
    this.searchMode = false;
    this.savedMode = false;
    this.searchQuery = '';
    this.els.searchInput.value = '';
    this.updateNavActive();
    this.els.headerTitle.textContent = this.t('categories', '__home__');
    this.loadNews();
  }

  openSaved() {
    this.savedMode = true;
    this.searchMode = false;
    this.searchQuery = '';
    this.els.searchInput.value = '';
    this.updateNavActive();
    this.renderSaved();
  }

  updateNavActive() {
    this.els.navList.querySelectorAll('.nav-item').forEach(btn => {
      const id = btn.dataset.category;
      const isActive = (id === '__saved__' && this.savedMode) || (!this.savedMode && id === this.category);
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
  }

  renderSaved() {
    const articles = Bookmarks.all();
    this.els.headerTitle.textContent = this.t('categories', '__saved__');
    this.els.statsText.textContent = this.t('states', 'savedArticles', articles.length);
    this.els.fetchTime.textContent = '';
    this.hideSkeleton();
    this.hideError();
    this.hideLoadMore();
    this.els.tickerWrap.hidden = true;
    this.els.newsGrid.innerHTML = '';

    if (articles.length === 0) {
      this.showEmpty(this.t('states', 'nothingSaved'));
      this.els.newsGrid.hidden = true;
      return;
    }
    this.hideEmpty();
    this.allArticles = articles;
    this.totalResults = articles.length;
    this.shownCount = articles.length;
    this.renderArticles(articles, false);
  }

  // ── Load + Render (stale-while-revalidate) ──
  async loadNews(append = false, forceFresh = false) {
    if (this.savedMode) { this.renderSaved(); return; }
    if (append && this.loading) return; // avoid duplicate load-more while already loading
    this.loading = true;
    const reqId = ++this._loadReqId; // monotonic request id for stale-response handling
    const isStale = () => reqId !== this._loadReqId;

    const cacheKey = this.searchMode ? `q:${this.searchQuery}` : `cat:${this.category}`;

    try {
      if (append) {
        this.els.loadMoreBtn.textContent = this.t('states','loadingMore');
        this.els.loadMoreBtn.disabled = true;
        const next = this.allArticles.slice(this.shownCount, this.shownCount + PAGE_SIZE);
        this.shownCount += next.length;
        this.renderArticles(next, true);
        if (this.shownCount >= this.totalResults) this.hideLoadMore();
        return;
      }

      this.hideError();
      this.hideEmpty();
      this.hideLoadMore();
      this.shownCount = 0;

      // 1) Render from cache immediately if available
      const fresh = forceFresh ? null : this.cacheGet(cacheKey);
      const anyCached = this.cacheGetAny(cacheKey);
      const initial = fresh || anyCached;

      if (initial && initial.length > 0) {
        this.allArticles = initial;
        this.totalResults = initial.length;
        this.hideSkeleton();
        this.els.newsGrid.innerHTML = '';
        this.renderBreakingTicker(initial);
        const next = initial.slice(0, PAGE_SIZE);
        this.shownCount = next.length;
        this.renderArticles(next, false);
        this.updateHeaderStats();
        if (this.shownCount < this.totalResults) this.showLoadMore();
      } else {
        this.showSkeleton();
        this.hideGrid();
      }

      if (fresh && !forceFresh) return; // cache is fresh, we're done

      // 2) Fetch fresh
      const items = this.searchMode
        ? await this.searchAll(this.searchQuery)
        : await this.fetchAllForCategory(this.category, forceFresh);

      if (isStale()) return;
      this.cacheSet(cacheKey, items);

      if (items.length === 0) {
        if (!initial || initial.length === 0) {
          this.hideSkeleton();
          if (this.searchMode) {
            this.showEmpty(this.t('states', 'noResultsSearch', this.searchQuery));
          } else if (this.category === '__home__') {
            // Home has no articles — usually means no prefs picked yet.
            this.showEmpty(this.t('states', 'noHomePrefs'));
            this.addHomeCustomizeButton();
          } else {
            this.showEmpty(this.t('states', 'noArticles'));
          }
          this.hideLoadMore();
        }
        return;
      }

      const topChanged = !initial || initial.length === 0 || initial[0]?.url !== items[0]?.url;
      this.allArticles = items;
      this.totalResults = items.length;

      if (topChanged) {
        this.hideSkeleton();
        this.els.newsGrid.innerHTML = '';
        this.renderBreakingTicker(items);
        this.shownCount = 0;
        const next = items.slice(0, PAGE_SIZE);
        this.shownCount = next.length;
        this.renderArticles(next, false);
        if (this.shownCount < this.totalResults) this.showLoadMore();
      }
      this.updateHeaderStats();
    } catch (err) {
      if (isStale()) return;
      if (this.allArticles.length === 0) {
        this.hideSkeleton();
        this.hideGrid();
        this.showError('Failed to load news', err.message || 'Please check your internet and try again.');
      }
    } finally {
      if (reqId === this._loadReqId) {
        this.loading = false;
        this.els.loadMoreBtn.textContent = this.t('states','loadMore');
        this.els.loadMoreBtn.disabled = false;
      }
    }
  }

  updateHeaderStats() {
    const label = this.searchMode
      ? `${this.t('search','label')}: "${this.searchQuery}"`
      : (this.t('categories', this.category) || '');
    this.els.headerTitle.textContent = label;
    this.els.statsText.textContent = `${this.totalResults.toLocaleString()} ${this.t('stats','articles')}`;
    this.refreshFetchTimeLabel();
  }

  // Re-renders just the "Updated X" label using the stored fetch timestamp.
  // Called on every loadNews AND periodically every 30s so the relative time
  // counts up even while you sit idle on a page.
  refreshFetchTimeLabel() {
    if (!this._lastFetchedAt) { this.els.fetchTime.textContent = ''; return; }
    this.els.fetchTime.textContent = `${this.t('stats','updated')} ${this.relativeTime(this._lastFetchedAt)}`;
  }

  relativeTime(ms) {
    const diff = Date.now() - ms;
    if (diff < 30_000)  return this.t('stats','justNow');
    if (diff < 60_000)  return this.t('stats','lessThanMinAgo');
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m} ${this.t('stats','minAgo')}`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}${this.t('stats','hAgo')}`;
    return new Date(ms).toLocaleDateString(this.lang === 'af' ? 'af-ZA' : 'en-US');
  }

  // ── Card rendering ──
  renderArticles(articles, append) {
    const fragment = document.createDocumentFragment();
    articles.forEach((article) => {
      // All cards uniform — no oversized "featured" card.
      fragment.appendChild(this.buildCard(article, false));
    });
    this.els.newsGrid.appendChild(fragment);
    this.els.newsGrid.hidden = false;
  }

  buildCard(article, featured = false) {
    const el = document.createElement('article');
    const isRead = ReadTracker.isRead(article.url); // whether the article was previously opened
    el.className = (featured ? 'card featured' : 'card') + (isRead ? ' read' : '');
    el.setAttribute('tabindex', '0'); // make card keyboard-focusable

    const ageMs = Date.now() - new Date(article.publishedAt).getTime();
    const ageMin = ageMs / 60000;
    const isBreaking = /\bbreaking\b/i.test(article.title); // detect breaking news
    const isNew = ageMin >= 0 && ageMin < 120; // new if published within 2 hours
    const badges = [
      isBreaking ? `<span class="badge badge-breaking">${this.t('card','breaking')}</span>` : '',
      (!isBreaking && isNew) ? `<span class="badge badge-new">${this.t('card','new')}</span>` : '',
    ].join('');

    const imgHtml = article.urlToImage
      ? `<img class="card-img" src="${this.escHtml(this.upgradeUrl(article.urlToImage))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';

    const sourceName = article.source?.name || 'Unknown';
    const placeholderEmoji = this.iconForCategory();
    const placeholderInitial = (sourceName[0] || '?').toUpperCase();
    const desc = article.description ? `<p class="card-desc">${this.escHtml(article.description)}</p>` : '';
    const readingMin = article.readingMin || 1;
    const bookmarked = Bookmarks.has(article.url); // whether this article is bookmarked

    el.innerHTML = `
      <div class="card-img-wrap">
        ${imgHtml}
        <div class="card-img-placeholder" ${article.urlToImage ? 'style="display:none"' : ''}>
          <div class="ph-initial">${this.escHtml(placeholderInitial)}</div>
          <div class="ph-source">${this.escHtml(sourceName)}</div>
          <div class="ph-emoji">${placeholderEmoji}</div>
        </div>
        ${badges ? `<div class="card-badges">${badges}</div>` : ''}
        <div class="card-actions">
          <button class="card-action-btn js-bookmark${bookmarked ? ' active' : ''}" aria-label="${bookmarked ? 'Remove bookmark' : 'Save article'}" title="${bookmarked ? 'Remove bookmark' : 'Save article'}">${bookmarked ? '★' : '☆'}</button>
          <button class="card-action-btn js-share" aria-label="Share article" title="Share article">↗</button>
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span class="card-source">${this.escHtml(sourceName)}</span>
          <span class="card-time">${this.timeAgo(article.publishedAt)}</span>
        </div>
        <h3 class="card-title">${this.escHtml(article.title)}</h3>
        ${desc}
        <div class="card-footer">
          <span class="card-read">${isRead ? this.t('card','read') : this.t('card','readArticle')}</span>
          <span class="card-read-time">${readingMin} ${this.t('card','minRead')}</span>
        </div>
      </div>
    `;

    // Click handlers
    const open = () => {
      ReadTracker.markRead(article.url);
      el.classList.add('read');
      const footer = el.querySelector('.card-read');
      if (footer) footer.textContent = this.t('card','read');
      window.open(article.url, '_blank', 'noopener,noreferrer');
    };
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-action-btn')) return;
      open();
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

    // Bookmark button
    const bmBtn = el.querySelector('.js-bookmark');
    bmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowOn = Bookmarks.toggle(article);
      bmBtn.textContent = nowOn ? '★' : '☆';
      bmBtn.classList.toggle('active', nowOn);
      bmBtn.setAttribute('aria-label', nowOn ? 'Remove bookmark' : 'Save article');
      bmBtn.title = nowOn ? 'Remove bookmark' : 'Save article';
      this.refreshSavedBadge();
      this.toast(nowOn ? this.t('toasts','saved') : this.t('toasts','removed'), nowOn ? 'success' : 'info');
    });

    // Share button
    const shareBtn = el.querySelector('.js-share');
    shareBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (navigator.share) {
          await navigator.share({ title: article.title, text: article.description || '', url: article.url });
        } else {
          await navigator.clipboard.writeText(article.url);
          this.toast(this.t('toasts','linkCopied'), 'success');
        }
      } catch (_) {}
    });

    // og:image lazy
    if (!article.urlToImage && article.url) {
      this.observeForOgImage(el, article.url);
    }

    return el;
  }

  refreshSavedBadge() {
    const btn = this.els.navList.querySelector('[data-category="__saved__"]');
    if (!btn) return;
    let badge = btn.querySelector('.nav-badge');
    const count = Bookmarks.all().length;
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
      }
      badge.textContent = String(count);
    } else if (badge) {
      badge.remove();
    }
    if (this.savedMode) this.renderSaved();
  }

  iconForCategory() {
    const cat = this.categories.find(c => c.id === this.category);
    return cat ? cat.icon : '📰';
  }

  renderBreakingTicker(articles) {
    const recent = articles.filter(a => {
      const ageMin = (Date.now() - new Date(a.publishedAt).getTime()) / 60000;
      return (ageMin >= 0 && ageMin < 60) || /\bbreaking\b/i.test(a.title);
    }).slice(0, 8);
    if (recent.length === 0) { this.els.tickerWrap.hidden = true; return; }
    this.els.tickerTrack.textContent = recent.map(a => `● ${a.title}`).join('   ');
    this.els.tickerWrap.hidden = false;
  }

  // ── og:image fallback ──
  async fetchOgImage(articleUrl) {
    if (!articleUrl) return null;
    const cacheKey = 'ogimg:' + articleUrl;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const { ts, img } = JSON.parse(raw);
        if (Date.now() - ts < OG_IMAGE_CACHE_TTL_MS) return img || null;
      }
    } catch {}

    const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(articleUrl);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(proxy, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const html = await res.text();
      const patterns = [
        /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
        /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
      ];
      let img = null;
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) { img = this.decodeHtmlEntities(m[1]); break; }
      }
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), img: img || '' })); } catch {}
      return img;
    } catch { return null; }
  }

  ensureImgObserver() {
    if (this.imgObserver) return this.imgObserver;
    this.imgObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const cardEl = e.target;
          const url = cardEl.dataset.articleUrl;
          this.imgObserver.unobserve(cardEl);
          if (url) this.enrichCardWithOgImage(cardEl, url);
        }
      }
    }, { rootMargin: '300px 0px', threshold: 0.01 });
    return this.imgObserver;
  }

  observeForOgImage(cardEl, articleUrl) {
    cardEl.dataset.articleUrl = articleUrl;
    this.ensureImgObserver().observe(cardEl);
  }

  async enrichCardWithOgImage(cardEl, articleUrl) {
    while (this._ogActive >= OG_IMAGE_CONCURRENCY) {
      await new Promise(r => setTimeout(r, 80));
    }
    this._ogActive++;
    try {
      const imgUrl = await this.fetchOgImage(articleUrl);
      if (!imgUrl || !cardEl.isConnected) return;
      const wrap = cardEl.querySelector('.card-img-wrap');
      if (!wrap) return;
      const placeholder = wrap.querySelector('.card-img-placeholder');
      const img = document.createElement('img');
      img.className = 'card-img';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = this.upgradeUrl(imgUrl);
      img.onerror = () => {
        img.remove();
        if (placeholder) placeholder.style.display = 'flex';
      };
      if (placeholder) {
        wrap.insertBefore(img, placeholder);
        placeholder.style.display = 'none';
      } else {
        wrap.prepend(img);
      }
    } finally { this._ogActive--; }
  }

  // ── Misc ──
  handleSearch(e) {
    e.preventDefault();
    const q = this.els.searchInput.value.trim();
    if (!q) { if (this.searchMode) this.selectCategory(this.category); return; }
    if (q === this.searchQuery && this.searchMode) return;
    RecentSearches.add(q);
    this.searchMode = true;
    this.savedMode = false;
    this.searchQuery = q;
    this.updateNavActive();
    this.hideRecentSearches();
    this.loadNews();
  }

  applyStoredTheme() {
    const saved = localStorage.getItem('news-theme') || 'light';
    this.setTheme(saved);
  }
  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('news-theme', theme);
    const isDark = theme === 'dark';
    this.els.themeIcon.textContent = isDark ? '☀️' : '🌙';
    this.els.themeText.textContent = isDark ? this.t('sidebar','lightMode') : this.t('sidebar','darkMode');
  }
  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    this.setTheme(current === 'dark' ? 'light' : 'dark');
  }

  startRefreshTimer() {
    this.refreshSeconds = 300;
    clearInterval(this.refreshTimer);
    this.updateTimerDisplay();
    this.refreshTimer = setInterval(() => {
      this.refreshSeconds--;
      this.updateTimerDisplay();
      if (this.refreshSeconds <= 0) this.refresh(false); // auto: don't hit the RSS feeds again, the server's already warming
    }, 1000);
  }
  updateTimerDisplay() {
    const m = Math.floor(this.refreshSeconds / 60);
    const s = this.refreshSeconds % 60;
    this.els.timerText.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }
  refresh(manual = true) {
    if (this.loading) return;
    this.els.refreshNowBtn.classList.add('spinning');
    // Optimistically mark fetch time as now so "Updated" label snaps to "just now".
    this._lastFetchedAt = Date.now();
    this.refreshFetchTimeLabel();
    // Spin for at least 600 ms (so it's visible) AND until the real fetch finishes.
    const minSpin = new Promise(r => setTimeout(r, 600));
    const load = this.loadNews(false, manual); // manual = force server-side refresh
    Promise.all([load, minSpin]).finally(() => {
      this.els.refreshNowBtn.classList.remove('spinning');
      if (manual) this.toast(this.t('toasts','updated'), 'success');
    });
    this.startRefreshTimer();
  }

  openSidebar() { this.els.sidebar.classList.add('open'); this.els.overlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
  closeSidebar() { this.els.sidebar.classList.remove('open'); this.els.overlay.classList.remove('open'); document.body.style.overflow = ''; }

  showSkeleton() {
    this.els.skeletonGrid.hidden = false;
    this.els.tickerWrap.hidden = true;
    this.els.statsText.textContent = this.t('stats','loading');
    this.els.fetchTime.textContent = '';
  }
  hideSkeleton() { this.els.skeletonGrid.hidden = true; }
  hideGrid() { this.els.newsGrid.hidden = true; }
  showError(title, msg) {
    this.els.errorTitle.textContent = title;
    this.els.errorMsg.textContent = msg;
    this.els.errorState.hidden = false;
  }
  hideError() { this.els.errorState.hidden = true; }
  showEmpty(msg) {
    this.els.emptyMsg.textContent = msg;
    this.els.emptyState.hidden = false;
  }
  hideEmpty() {
    this.els.emptyState.hidden = true;
    const cta = this.$('homeCustomizeBtn');
    if (cta) cta.remove();   // tear down so it doesn't pile up across re-renders
  }
  showLoadMore() { this.els.loadMoreWrap.hidden = false; }
  hideLoadMore() { this.els.loadMoreWrap.hidden = true; }

  // ── Pure utils ──
  pickThumbnail(item) {
    const candidates = [
      item.thumbnail, item.enclosure?.link,
      this.firstImgIn(item.content), this.firstImgIn(item.description),
    ];
    for (const url of candidates) {
      if (url && /^https?:|^\/\//i.test(url)) return this.upgradeUrl(url);
    }
    return null;
  }
  firstImgIn(html) {
    if (!html || typeof html !== 'string') return null;
    const m = html.match(/<img[^>]+src\s*=\s*["']?([^"'\s>]+)/i);
    return m ? this.decodeHtmlEntities(m[1]) : null;
  }
  decodeHtmlEntities(str) {
    if (!str) return str;
    const tmp = document.createElement('textarea');
    tmp.innerHTML = str;
    return tmp.value;
  }
  upgradeUrl(url) {
    if (!url) return url;
    if (url.startsWith('http://')) return 'https://' + url.slice(7);
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }
  stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = (tmp.textContent || tmp.innerText || '').trim();
    return text.length > 260 ? text.slice(0, 260).trim() + '…' : text;
  }
  estimateReadingMin(html) {
    const words = (this.stripHtml(html) || '').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.min(20, Math.round((words * 5) / 200)));
  }
  timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return 'Just now';
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }
  formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Toast notifications ──
  toast(message, type = 'info') {
    const container = this.$('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2400);
  }

  // ── Recent searches dropdown ──
  showRecentSearches() {
    const recents = RecentSearches.all();
    this.hideRecentSearches();
    if (recents.length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'recent-searches';
    wrap.id = 'recentSearches';
    wrap.innerHTML = `
      <div class="recent-searches-head">
        <span>${this.t('search','recentSearches')}</span>
        <span class="recent-searches-clear">${this.t('search','clearAll')}</span>
      </div>
      ${recents.map(q => `
        <div class="recent-search-item" data-query="${this.escHtml(q)}">
          <span class="icon">⏱</span>
          <span>${this.escHtml(q)}</span>
          <span class="clear" data-remove="${this.escHtml(q)}">✕</span>
        </div>
      `).join('')}
    `;
    const container = this.els.searchForm.parentElement;
    container.appendChild(wrap);

    wrap.querySelector('.recent-searches-clear').addEventListener('click', () => {
      RecentSearches.clear();
      this.hideRecentSearches();
    });
    wrap.querySelectorAll('.recent-search-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('clear')) {
          RecentSearches.remove(e.target.dataset.remove);
          this.showRecentSearches();
          return;
        }
        const q = item.dataset.query;
        this.els.searchInput.value = q;
        this.searchMode = true;
        this.savedMode = false;
        this.searchQuery = q;
        this.updateNavActive();
        this.loadNews();
        this.hideRecentSearches();
      });
    });
  }
  hideRecentSearches() {
    const existing = this.$('recentSearches');
    if (existing) existing.remove();
  }

  // ── Keyboard shortcuts ──
  showShortcuts()  { const el = this.$('shortcutsOverlay'); if (el) el.hidden = false; }
  hideShortcuts()  { const el = this.$('shortcutsOverlay'); if (el) el.hidden = true; }

  // Live search — fires 300ms after the user stops typing, no Enter needed.
  liveSearch() {
    clearTimeout(this._searchDebounce);
    this._searchDebounce = setTimeout(() => {
      const q = this.els.searchInput.value.trim();
      if (q.length === 0) {
        if (this.searchMode) this.selectCategory(this.category);
        return;
      }
      if (q.length < 2) return; // skip 1-character queries
      if (q === this.searchQuery && this.searchMode) return;
      RecentSearches.add(q);
      this.searchMode = true;
      this.savedMode  = false;
      this.searchQuery = q;
      this.updateNavActive();
      this.hideRecentSearches();
      this.loadNews();
    }, 300);
  }

  // ── Events ──
  bindEvents() {
    this.els.searchForm.addEventListener('submit', e => this.handleSearch(e));
    this.els.searchInput.addEventListener('input', () => this.liveSearch());
    this.els.searchInput.addEventListener('focus', () => {
      if (this.els.searchInput.value.trim().length === 0) this.showRecentSearches();
    });
    this.els.searchInput.addEventListener('blur', () => {
      // delay so click events on dropdown items fire first
      setTimeout(() => this.hideRecentSearches(), 150);
    });
    this.els.themeBtn.addEventListener('click', () => this.toggleTheme());
    this.els.refreshNowBtn.addEventListener('click', () => this.refresh());
    const retryBtn = this.$('retryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => { this.hideError(); this.loadNews(); });
    this.els.loadMoreBtn.addEventListener('click', () => this.loadNews(true));
    this.els.menuBtn.addEventListener('click', () => this.openSidebar());
    this.els.sidebarClose.addEventListener('click', () => this.closeSidebar());
    this.els.overlay.addEventListener('click', () => this.closeSidebar());

    // Shortcuts modal
    const shortcutsClose = this.$('shortcutsClose');
    const shortcutsOverlay = this.$('shortcutsOverlay');
    if (shortcutsClose) shortcutsClose.addEventListener('click', () => this.hideShortcuts());
    if (shortcutsOverlay) shortcutsOverlay.addEventListener('click', (e) => {
      if (e.target === shortcutsOverlay) this.hideShortcuts();
    });

    document.addEventListener('keydown', e => {
      const inInput = e.target.matches('input, textarea, [contenteditable]');

      // Always-available: Escape
      if (e.key === 'Escape') {
        if (!this.$('shortcutsOverlay').hidden) { this.hideShortcuts(); return; }
        if (inInput) { this.els.searchInput.blur(); return; }
        if (this.searchMode) this.selectCategory(this.category);
        this.closeSidebar();
        return;
      }

      // Focus search with /
      if (e.key === '/' && !inInput) {
        e.preventDefault();
        this.els.searchInput.focus();
        return;
      }

      // The rest of the shortcuts only fire when not typing
      if (inInput) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); this.showShortcuts(); return; }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.refresh(); return; }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); this.toggleTheme(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); this.openSaved(); return; }
      // Number keys 1-9 switch category
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const cat = this.categories[idx];
        if (cat) { e.preventDefault(); this.selectCategory(cat.id); }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => new NewsApp());

// PWA: register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  });
}
