/** WidgetAI.net (ported from MVP) + Phase E verification tiers (`reportVerified`). */
export const netSection = () => `
__api.net = {
  operations: async () => { __need('network'); return (await __request('WIDGET_NET_OPS', {})).operations; },
  invoke: async (opId, overrides) => { __need('network'); return (await __request('WIDGET_NET_INVOKE', { opId, overrides: overrides || {} })).result; },
  request: async (req) => { __need('network'); return (await __request('WIDGET_NET_REQUEST', { request: req })).result; },
  /** After a read-back confirmed the op's effect: promote its template to tier "verified". Resolves {verified, tier, error?}; never throws for a refusal. */
  reportVerified: async (opId, evidence) => {
    __need('network');
    const ev = typeof evidence === 'string' ? { readBack: evidence } : { readBack: String((evidence && (evidence.readBack || evidence.detail)) || 'read-back ok'), detail: evidence && evidence.detail ? String(evidence.detail) : undefined };
    ev.readBack = ev.readBack.slice(0, 400); if (ev.detail) ev.detail = ev.detail.slice(0, 400); else delete ev.detail;
    const r = await __request('WIDGET_NET_REPORT_VERIFIED', { opId, evidence: ev });
    return { verified: !!r.verified, tier: r.tier, error: r.error };
  },
};
`;
