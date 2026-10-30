/**
 * Redact secrets before writing demo-check logs or stdout.
 */

/** @type {string[]} */
let literalTokens = []

/** @param {{ bypassSecret?: string, shareToken?: string }} [opts] */
export function configureRedaction(opts = {}) {
  literalTokens = []
  const bypass = opts.bypassSecret?.trim()
  const share = opts.shareToken?.trim()
  for (const value of [bypass, share]) {
    if (!value) continue
    literalTokens.push(value)
    try {
      literalTokens.push(encodeURIComponent(value))
    } catch {
      /* ignore */
    }
  }
}

/** @param {string} text */
function redactKnownLiterals(text) {
  let out = text
  for (const token of literalTokens) {
    if (token.length < 2) continue
    out = out.split(token).join("REDACTED")
  }
  return out
}

/** @param {URL} parsed */
function redactSearchParams(parsed) {
  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase()
    if (lower === "_vercel_share" || lower === "x-vercel-protection-bypass") {
      parsed.searchParams.set(key, "REDACTED")
      continue
    }
    const value = parsed.searchParams.get(key)
    if (!value) continue
    if (
      value.includes("_vercel_share") ||
      value.includes("%5Fvercel%5Fshare") ||
      value.toLowerCase().includes("x-vercel-protection-bypass")
    ) {
      parsed.searchParams.set(key, redactSensitiveText(value))
    }
  }
  return parsed
}

/** @param {string} url */
export function redactUrl(url) {
  if (!url) return url
  try {
    const parsed = redactSearchParams(new URL(url))
    return redactKnownLiterals(redactSensitiveText(parsed.toString()))
  } catch {
    return redactKnownLiterals(redactSensitiveText(url))
  }
}

/** @param {string} text */
export function redactSensitiveText(text) {
  if (!text) return text
  let out = String(text)
  out = out.replace(/(_vercel_share=)[^&\s"'#]+/gi, "$1REDACTED")
  out = out.replace(/([?&]_vercel_share=)[^&\s"'#]+/gi, "$1REDACTED")
  out = out.replace(/(%5[fF]vercel%5[fF]share%3[dD])([^&%"'\\s]+)/g, "$1REDACTED")
  out = out.replace(/(%26|%3[fF])_vercel_share%3[dD][^&%"'\\s]*/gi, (match) =>
    match.replace(/%3[dD][^&%]*/i, "%3DREDACTED"),
  )
  out = out.replace(/([?&])(x-vercel-protection-bypass=)([^&\s"'#]+)/gi, "$1$2REDACTED")
  out = out.replace(/(%3[fF]x-vercel-protection-bypass%3[dD])([^&%"'\\s]+)/gi, "$1REDACTED")
  out = out.replace(/(x-vercel-protection-bypass\s*[:=]\s*)[^\s"',]+/gi, "$1REDACTED")
  out = out.replace(/("x-vercel-protection-bypass"\s*:\s*")[^"]+(")/gi, '$1REDACTED$2')
  out = out.replace(/(VERCEL_AUTOMATION_BYPASS_SECRET\s*[:=]\s*)[^\s"',]+/gi, "$1REDACTED")
  out = redactKnownLiterals(out)
  return out
}
