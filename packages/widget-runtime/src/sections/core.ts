/** WidgetAI.inference / log / status / storage (ported from MVP). */
export const coreSection = () => `
__api.inference = async ({ prompt, context, instruction } = {}) => {
  __need('inference');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('inference prompt must be a non-empty string');
  return (await __request('WIDGET_INFERENCE', { prompt, context, instruction })).text;
};
__api.log = (message, level) => __send({ type: 'WIDGET_LOG', level: level || 'info', message: String(message) });
__api.status = (status, detail) => __send({ type: 'WIDGET_STATUS', status, detail: detail === undefined ? undefined : String(detail) });
__api.storage = {
  get: async (key) => { __need('storage'); return (await __request('WIDGET_STORAGE', { op: 'get', key })).value; },
  set: async (key, value) => { __need('storage'); await __request('WIDGET_STORAGE', { op: 'set', key, value }); },
  remove: async (key) => { __need('storage'); await __request('WIDGET_STORAGE', { op: 'remove', key }); },
};
`;
