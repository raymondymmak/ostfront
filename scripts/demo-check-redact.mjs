/**
 * Redact secrets before writing demo-check logs or stdout.
 */

/** @param {string} url */
export function redactUrl(url) {
  if (!url) return url
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has("_vercel_share")) {
      parsed.searchParams.set("_vercel_share", "REDACTED")
    }
    return parsed.toString()
  } catch {
    return redactSensitiveText(url)
  }
}

/** @param {string} text */
export function redactSensitiveText(text) {
  if (!text) return text
  let out = String(text)
  out = out.replace(/(_vercel_share=)[^&\s"'#]+/gi, "$1REDACTED")
  out = out.replace(/([?&]_vercel_share=)[^&\s"'#]+/gi, "$1REDACTED")
  out = out.replace(/(x-vercel-protection-bypass\s*[:=]\s*)[^\s"',]+/gi, "$1REDACTED")
  out = out.replace(/("x-vercel-protection-bypass"\s*:\s*")[^"]+(")/gi, '$1REDACTED$2')
  out = out.replace(/(VERCEL_AUTOMATION_BYPASS_SECRET\s*[:=]\s*)[^\s"',]+/gi, "$1REDACTED")
  return out
}
