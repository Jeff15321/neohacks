/**
 * Phase A: canned WidgetAI.db widgets for the CineBase fixture (`/fixture-movies/`), written like real generated code.
 * "Save movie" (movie detail page) writes `saved_movies`; "My saved movies" (watchlist page) reads it.
 */

export const MOCK_WIDGET_CODE_MOVIE_SAVE = `
const detail = document.querySelector('.movie-detail[data-movie-id]');
if (!detail) { WidgetAI.status('completed', 'not a movie page'); return; }
const ROOT_ID = 'wwa-save-movie';
document.getElementById(ROOT_ID)?.remove(); // idempotent re-run
const hostEl = document.createElement('div');
hostEl.id = ROOT_ID;
hostEl.style.display = 'inline-flex';
(detail.querySelector('.movie-actions') || detail).appendChild(hostEl);
const root = hostEl.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = 'button { font: 13px system-ui; padding: 7px 14px; border-radius: 18px; border: 1px solid #f5c518; background: #f5c518; color: #000; font-weight: 600; cursor: pointer; } button[data-saved="1"] { background: #fff; } #st { font: 12px system-ui; color: #555; margin-left: 8px; }';
const btn = document.createElement('button');
btn.id = 'save';
const st = document.createElement('span');
st.id = 'st';
root.append(style, btn, st);

const movieId = detail.getAttribute('data-movie-id');
const title = detail.querySelector('.movie-title')?.textContent?.trim() || document.title;
const year = Number(detail.querySelector('.movie-year')?.textContent?.trim()) || null;
const setSaved = (saved) => { btn.textContent = saved ? 'Saved \\u2713' : 'Save movie'; btn.dataset.saved = saved ? '1' : '0'; };
setSaved(false);
try {
  setSaved(!!(await WidgetAI.db.get('saved_movies', movieId)));
} catch (err) {
  WidgetAI.log('could not read saved state: ' + err.message, 'warn');
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    // stable id = the movie id, so saving twice never duplicates
    const doc = await WidgetAI.db.add('saved_movies', { title, year, url: location.href, savedAt: new Date().toISOString() }, movieId);
    setSaved(true);
    st.textContent = 'Saved';
    WidgetAI.log('saved "' + title + '" as ' + doc.id);
    WidgetAI.status('completed', 'saved ' + title);
  } catch (err) {
    st.textContent = 'Save failed: ' + err.message;
    WidgetAI.status('failed', err.message);
  } finally {
    btn.disabled = false;
  }
});
WidgetAI.status('completed', 'save button ready');
`;

export const MOCK_WIDGET_CODE_MOVIE_LIST = `
const ROOT_ID = 'wwa-saved-movies';
document.getElementById(ROOT_ID)?.remove(); // idempotent re-run
const mount = document.querySelector('#watchlist-sidebar') || document.querySelector('[role="complementary"]') || document.body;
const hostEl = document.createElement('div');
hostEl.id = ROOT_ID;
mount.prepend(hostEl);
const root = hostEl.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = '.box { font: 13px system-ui; border: 1px solid #f5c518; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; } h3 { margin: 0 0 6px; font-size: 14px; } ul { margin: 0; padding-left: 18px; } li { margin: 3px 0; } .muted { color: #666; font-size: 12px; } button { font: 12px system-ui; margin-top: 6px; cursor: pointer; }';
const box = document.createElement('div'); box.className = 'box';
const h = document.createElement('h3'); h.textContent = 'My saved movies';
const list = document.createElement('ul'); list.id = 'list';
const st = document.createElement('div'); st.id = 'st'; st.className = 'muted';
const refresh = document.createElement('button'); refresh.id = 'refresh'; refresh.textContent = 'Refresh';
box.append(h, list, st, refresh);
root.append(style, box);

// Docs may have been written by any widget: treat as untrusted data, render with textContent only.
const render = async () => {
  st.textContent = 'Loading...';
  const docs = await WidgetAI.db.list('saved_movies', { limit: 100 });
  list.replaceChildren();
  for (const d of docs) {
    const li = document.createElement('li');
    li.className = 'saved-movie';
    const a = document.createElement('a');
    const url = String(d.data?.url ?? '');
    if (/^https?:\\/\\//i.test(url)) a.href = url;
    a.textContent = String(d.data?.title ?? d.id);
    li.append(a);
    if (d.data?.year) li.append(document.createTextNode(' (' + String(d.data.year) + ')'));
    list.append(li);
  }
  st.textContent = docs.length ? docs.length + ' saved' : 'No saved movies yet';
  WidgetAI.log('listed ' + docs.length + ' saved movie(s)');
  return docs.length;
};
refresh.addEventListener('click', () => { render().catch((err) => { st.textContent = 'Failed: ' + err.message; }); });
try {
  const n = await render();
  WidgetAI.status('completed', n + ' saved movie(s)');
} catch (err) {
  st.textContent = 'Failed to load: ' + err.message;
  WidgetAI.status('failed', err.message);
}
`;

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

export interface MockWidget { name: string; description: string; matchPatterns: string[]; grants: string[]; insertionHint: string; code: string; plan: string[]; collections?: string[] }

/** Returns the movies widget for a fixture-movies user prompt, else undefined. */
export function moviesMockWidget(user: string): MockWidget | undefined {
  const url = user.match(/^url: (\S+)/m)?.[1] ?? '';
  if (!/fixture-movies/.test(url)) return undefined;
  const request = user.match(/USER REQUEST: (.*)/)?.[1] ?? '';
  if (/fixture-movies\/watchlist/.test(url) || /^\s*(show|list|display)\b/i.test(request)) {
    return {
      name: 'My saved movies', description: 'Sidebar panel listing the movies you saved with any widget (collection saved_movies).',
      matchPatterns: LOCAL_HOSTS.map(h => `*://${h}/fixture-movies/watchlist*`), grants: ['data', 'log'], collections: ['saved_movies'],
      insertionHint: 'Panel at the top of the watchlist sidebar.', code: MOCK_WIDGET_CODE_MOVIE_LIST,
      plan: ['Add a "My saved movies" panel to the sidebar', 'Read your saved movies from your data store (saved_movies)', 'Show each title, linking back to its page'],
    };
  }
  return {
    name: 'Save movie', description: 'Adds a "Save movie" button that stores the movie in your saved_movies collection.',
    matchPatterns: [...LOCAL_HOSTS.map(h => `*://${h}/fixture-movies/movie*`), '*://*.imdb.com/title/*'], grants: ['data', 'log'], collections: ['saved_movies'],
    insertionHint: 'Button in the movie actions toolbar.', code: MOCK_WIDGET_CODE_MOVIE_SAVE,
    plan: ['Add a "Save movie" button next to the trailer button', 'When clicked, save the title, year and link to your data store (saved_movies)', 'Show "Saved" when the movie is already saved'],
  };
}
