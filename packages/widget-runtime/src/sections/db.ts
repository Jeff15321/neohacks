/**
 * Prelude section — owner: Phase A. WidgetAI.db: the user's shared data store (grant "data").
 * Path: user script → SW `WIDGET_DATA` (bus checks widget/approval/origin/grant; modules/data checks the
 * collection is declared) → backend /api/data. The widget never sees the extension token or the user id.
 */
export const dbSection = (): string => `
const __db = (op, collection, extra) => {
  __need('data');
  if (typeof collection !== 'string' || !collection) throw new Error('WidgetAI.db: collection must be a non-empty string');
  return __request('WIDGET_DATA', { op, collection, ...extra });
};
const __dbObj = (v, what) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('WidgetAI.db: ' + what + ' must be a plain JSON object');
  return JSON.parse(JSON.stringify(v));
};
__api.db = Object.freeze({
  list: async (collection, opts = {}) => (await __db('list', collection, { query: { where: opts.where, limit: opts.limit, after: opts.after } })).docs,
  get: async (collection, id) => (await __db('get', collection, { id: String(id) })).doc ?? null,
  add: async (collection, data, id) => (await __db('add', collection, { data: __dbObj(data, 'data'), ...(id === undefined || id === null ? {} : { id: String(id) }) })).doc,
  update: async (collection, id, patch) => (await __db('update', collection, { id: String(id), data: __dbObj(patch, 'patch') })).doc,
  remove: async (collection, id) => !!(await __db('remove', collection, { id: String(id) })).removed,
});
`;
