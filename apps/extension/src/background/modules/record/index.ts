import { newTraceId } from '@app/core';
import type { Bus } from '../../bus.js';
import { commands, tabs, webNavigation } from '../../platform/index.js';
import { RecordService } from './service.js';

/** Phase B: recording (commands, REC badge/pill, RecordingSession, interpret → spec → generate). See README.md. */
export function registerRecord(bus: Bus) {
  const svc = new RecordService(bus);
  (globalThis as { __wwaRecord?: RecordService }).__wwaRecord = svc; // debugging + E1 (commandLog)

  bus.use('steps.subscribe')((s, update) => svc.onStep(s, update));

  commands.onCommand((command, tab) => {
    svc.commandLog.push({ command, ts: Date.now() });
    console.log('[wwa] command', command);
    if (command === 'toggle-recording') void svc.toggle(newTraceId(), tab?.id).catch(e => bus.broadcast({ type: 'ERROR', message: String(e?.message ?? e) }));
  });
  tabs.onActivated((tabId, windowId) => void svc.onTabActivated(tabId, windowId));
  webNavigation.onCommitted(d => void svc.onNavigation(d.tabId, d.url, d.transitionType));

  // panel → SW
  bus.on('REC_START', async (m, ctx) => ({ session: await svc.start(ctx.traceId, m.tabId) }));
  bus.on('REC_STOP', async (_m, ctx) => ({ session: await svc.stop(ctx.traceId) }));
  bus.on('REC_GET', async () => {
    await svc.ready;
    const st = svc.state;
    return { session: st?.session ?? null, steps: st?.steps ?? [], semantic: st?.semantic ?? {}, spec: st?.spec ?? null, widgetId: st?.widgetId };
  });
  bus.on('REC_INTERPRET', async (m, ctx) => ({ spec: await svc.interpret(ctx.traceId, m) }));
  bus.on('REC_GENERATE', async (m, ctx) => ({ widget: await svc.generate(ctx.traceId, m) }));
  bus.on('REC_DISCARD', async (_m, ctx) => { await svc.discard(ctx.traceId); });

  // content → SW
  bus.onPage('WWA_REC_QUERY', async (_m, ctx) => { await svc.ready; return svc.captureFor(ctx.sender.tab); });
  bus.onPage('WWA_REC_STOP', async (_m, ctx) => ({ session: await svc.stop(ctx.traceId) }));
  return svc;
}
