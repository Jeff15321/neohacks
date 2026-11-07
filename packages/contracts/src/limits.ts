/** Limits mirrored by extension + backend enforcement. */
export const LIMITS = {
  PROMPT_MAX_CHARS: 10_000,
  CONTEXT_MAX_CHARS: 50_000,
  REQUEST_MAX_CHARS: 4_000,
  INFERENCE_TIMEOUT_MS: 120_000,
  INFERENCE_RPM_PER_WIDGET: 20,
  GENERATION_TIMEOUT_MS: 600_000,
  CODE_MAX_CHARS: 120_000,
  /** Network capture caps. */
  NET_MAX_RECORDS_PER_TAB: 80,
  NET_MAX_GESTURES_PER_TAB: 30,
  NET_MAX_WEBREQUESTS_PER_TAB: 200,
  NET_BODY_STORE_CHARS: 64_000,
  NET_BODY_SUMMARY_CHARS: 2_000,
  NET_RESPONSE_SAMPLE_CHARS: 600,
  NET_INVOKE_TIMEOUT_MS: 30_000,
  NET_INVOKE_RESULT_CHARS: 50_000,
  /** A request counts as gesture-triggered if it starts within this many ms after the gesture. */
  NET_TRIGGER_WINDOW_MS: 6_000,
  /** Probe record ↔ webRequest cross-match tolerance. */
  NET_CONFIRM_WINDOW_MS: 2_000,
  BUS_LOG_SIZE: 400,
} as const;
