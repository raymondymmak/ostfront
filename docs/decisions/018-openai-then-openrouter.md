# Try OpenAI before the existing OpenRouter client

**Status:** accepted  
**Date:** 2026-11-24

## Context

Game-master diplomacy, `/api/advisor`, and the teach reasoning coach shared one OpenAI-compatible client (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, optional `LLM_MODEL_STRONG`). Production points that client at OpenRouter (`z-ai/glm-5.3-flash`). A failed call fell through to the staff simulation. Raymond wants OpenAI tried first, with that OpenRouter setup left in place as the backup.

## Decision

`resolveProviderChain` in `lib/gm/providers.ts` orders providers:

1. **OpenAI** when `OPENAI_API_KEY` is set. `OPENAI_MODEL` defaults to `gpt-6.1-terra` (the model id on the OpenAI docs as of 24 Nov 2026; not `gpt-6-terra`). Chat Completions send `reasoning_effort` from `OPENAI_REASONING_EFFORT`, default `medium`. Terra documents `none`, `low`, `medium` (its API default), `high`, `xhigh`, and `max`. `minimal` is not a Terra value and falls back to `medium`. Responses would use `reasoning.effort` instead; this client stays on Chat Completions.
2. **Backup** when `LLM_API_KEY` is set. Base URL, model, and `LLM_MODEL_STRONG` are unchanged. Strong-model escalation stays inside this provider.
3. **Staff simulation** when no provider answers. Stavka still owns Russian orders either way.

Fail over to the next provider on timeout, HTTP 429, HTTP 5xx, a missing key (that provider is omitted), an empty reply, JSON that will not parse, or JSON that fails schema validation. Any other unsuccessful HTTP or transport error also yields, so a dead primary cannot skip a live backup.

The first provider gets about half of `GM_BUDGET_MS` (default 90s, per-call cap `LLM_TIMEOUT_MS` 45s). Advisor (20s) and teach coach (18s) split their own timeouts the same way. Those clocks are unchanged for Terra at medium: a slow OpenAI attempt fails over inside the existing half, it does not lengthen the budget. Compatibility retries (dropping `reasoning_effort`, `max_completion_tokens`, or `json_schema`) share that same provider deadline and recompute the time left before each request. OpenAI omits `temperature` unless effort is `none`, uses `max_completion_tokens`, and `response_format.json_schema.strict: true` (`OPENAI_GM_JSON_SCHEMA`, `CAMPAIGN_COACH_JSON_SCHEMA`, `TEACH_COACH_JSON_SCHEMA`). The backup still sends OpenRouter's `reasoning: { effort: "low", exclude: true }` and `strict: false` when the base URL is OpenRouter.

`ostfront.gm.call`, `ostfront.llm.log`, and Blob LLM records include `provider` and `model`. OpenRouter `HTTP-Referer` / `X-Title` headers are not sent to OpenAI.

## Consequences

- No keys: staff simulation, as before. Only the backup key: the previous client.
- Both keys: OpenAI answers when it returns valid JSON inside its half of the budget.
- The advisor browser abort stays 25s. With both keys the 20s coach budget is split so the backup still fits.
- The eval judge uses the first configured provider. `EVAL_JUDGE_MODEL` must be a model that provider serves.
