# plugins/

- **tracing** — `req.traceId` from `x-trace-id` (else generated), echoed as a response header; one JSON log line per
  request `{traceId, module:'http', event, ms, ok}`.
- **auth** — `x-extension-token` must equal `EXTENSION_AUTH_TOKEN` on everything except `/health` and `/fixture*`;
  optional `x-user-id` (uuid install id from the extension) → `req.userId`.
- **errors** — uniform `{ok:false, error, code, traceId}`. Routes throw `HttpError(status, msg, code)`;
  `parseOr400(schema, body, type)` validates with the zod contract and names the boundary + message type.
