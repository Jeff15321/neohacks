/** WidgetAI.net (ported from MVP). Owner of later changes: Phase E. */
export const netSection = () => `
__api.net = {
  operations: async () => { __need('network'); return (await __request('WIDGET_NET_OPS', {})).operations; },
  invoke: async (opId, overrides) => { __need('network'); return (await __request('WIDGET_NET_INVOKE', { opId, overrides: overrides || {} })).result; },
  request: async (req) => { __need('network'); return (await __request('WIDGET_NET_REQUEST', { request: req })).result; },
};
`;
