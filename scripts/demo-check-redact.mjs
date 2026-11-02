/**
 * Redact secrets before writing demo-check logs or stdout.
 */

/** @type {string[]} */
let literalForms = []

/** @param {string} value */
function formsForLiteral(value) {
  const trimmed = value.trim()
  if (!trimmed) return []
  const forms = new Set([trimmed])
  try {
    const enc = encodeURIComponent(trimmed)
    forms.add(enc)
    forms.add(enc.toUpperCase())
    forms.add(enc.toLowerCase())
    forms.add(encodeURIComponent(enc))
    const mixedCase = enc.replace(/%([0-9a-f]{2})/gi, (_, hex) => {
      const a = hex[0] ?? ""
      const b = hex[1] ?? ""
      return `%${a.toUpperCase()}${b.toLowerCase()}`
    })
    forms.add(mixedCase)
  } catch {
    /* ignore */
  }
  try {
    const b64 = Buffer.from(trimmed, "utf8").toString("base64")
    forms.add(b64)
    forms.add(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))
  } catch {
    /* ignore */
  }
  return [...forms].filter((item) => item.length > 0)
}

/** @param {{ bypassSecret?: string, shareToken?: string }} [opts] */
export function configureRedaction(opts = {}) {
  const all = new Set()
  for (const value of [opts.bypassSecret, opts.shareToken]) {
    for (const form of formsForLiteral(value ?? "")) all.add(form)
  }
  literalForms = [...all].sort((a, b) => b.length - a.length)
}

/** @param {string} text */
function redactKnownLiterals(text) {
  let out = text
  for (const token of literalForms) {
    if (token.length < 1) continue
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
  out = out.replace(/(%5[fF]vercel%5[fF]share%3[dD])([^&%"'\s]+)/g, "$1REDACTED")
  out = out.replace(/(%26|%3[fF])_vercel_share%3[dD][^&%"'\s]*/gi, (match) =>
    match.replace(/%3[dD][^&%]*/i, "%3DREDACTED"),
  )
  out = out.replace(/([?&])(x-vercel-protection-bypass=)([^&\s"'#]+)/gi, "$1$2REDACTED")
  out = out.replace(/(%3[fF]x-vercel-protection-bypass%3[dD])([^&%"'\s]+)/gi, "$1REDACTED")
  out = out.replace(/(x-vercel-protection-bypass\s*[:=]\s*)[^\s"',]+/gi, "$1REDACTED")
  out = out.replace(/("x-vercel-protection-bypass"\s*:\s*")[^"]+(")/gi, '$1REDACTED$2')
  out = out.replace(/(VERCEL_AUTOMATION_BYPASS_SECRET\s*[:=]\s*)[^\s"',]+/gi, "$1REDACTED")
  out = out.replace(/(Authorization\s*:\s*Basic\s+)[A-Za-z0-9+/=_-]+/gi, "$1REDACTED")
  out = out.replace(/(https?:\/\/)[^/\s"'#@]+@/gi, "$1REDACTED@")
  out = redactKnownLiterals(out)
  return out
}

/** @param {string} token */
export function substringsOfMinLength(token, min = 6) {
  const parts = []
  if (token.length < min) return parts
  for (let len = min; len <= token.length; len++) {
    for (let i = 0; i <= token.length - len; i++) {
      parts.push(token.slice(i, i + len))
    }
  }
  return parts
}
