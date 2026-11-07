/**
 * Redaction of typed values in Steps (owner: Phase B). Reuses the network redaction primitives (`looksSecret`,
 * `redactBody`). Applied in the content script at capture time AND again in the SW before anything leaves it
 * (backend calls, panel exports) — defence in depth: no password or typed secret may appear in an export.
 */
import { REDACTED, looksSecret, redactBody } from './redact.js';

export interface FieldInfo {
  /** input type attribute (password, email, text, …) */
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  ariaLabel?: string;
  placeholder?: string;
}

const SECRET_FIELD = /pass|pwd|secret|token|otp|one.?time|2fa|mfa|cvv|cvc|ssn|pin\b|api[-_ ]?key|auth|card.?number|cc-?num|security.?code/i;
const SECRET_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp.*)$/i;

/** True when the field itself is sensitive (its value must never leave the page, even partially). */
export function isSecretInput(f: FieldInfo): boolean {
  if ((f.type ?? '').toLowerCase() === 'password') return true;
  if (f.autocomplete && SECRET_AUTOCOMPLETE.test(f.autocomplete.trim())) return true;
  return [f.name, f.id, f.ariaLabel, f.placeholder].some(s => !!s && SECRET_FIELD.test(s));
}

/** Card-number-like digit runs (13–19 digits, optional spaces/dashes) and long digit runs. */
const CARDISH = /\b(?:\d[ -]?){13,19}\b/g;

/** Redacted, clipped preview of a committed input value. */
export function redactTypedValue(value: string, field: FieldInfo = {}, maxChars = 200): string {
  if (isSecretInput(field)) return REDACTED;
  let v = value.replace(/\s+/g, ' ').trim();
  if (looksSecret(v)) return REDACTED;
  v = v.replace(CARDISH, REDACTED);
  v = redactBody(v) ?? v;
  return v.length > maxChars ? v.slice(0, maxChars) + '…' : v;
}

/** Deep re-redaction of a Step-like object's free-text fields before export (valuePreview, clipboard text). */
export function redactStepForExport<T extends { action: { valuePreview?: string } }>(s: T): T {
  const vp = s.action.valuePreview;
  if (vp === undefined) return s;
  return { ...s, action: { ...s.action, valuePreview: vp === REDACTED ? vp : redactTypedValue(vp) } };
}
