import { describe, expect, it } from "vitest"
import {
  configureRedaction,
  redactSensitiveText,
  redactUrl,
  substringsOfMinLength,
} from "../scripts/demo-check-redact.mjs"

function expectNoTokenLeak(text: string, token: string) {
  for (const part of substringsOfMinLength(token, 6)) {
    expect(text).not.toContain(part)
  }
}

describe("demo-check redaction", () => {
  it("redacts _vercel_share query values in URLs and text", () => {
    const token = "secret-token-abc"
    configureRedaction({ shareToken: token })
    const raw = `https://preview.vercel.app/?_vercel_share=${token}&foo=1`
    expect(redactUrl(raw)).toBe("https://preview.vercel.app/?_vercel_share=REDACTED&foo=1")
    const redacted = redactSensitiveText(`open ${raw}`)
    expect(redacted).toContain("_vercel_share=REDACTED")
    expectNoTokenLeak(redacted, token)
  })

  it("redacts URL-encoded share tokens inside redirect query params", () => {
    const token = "nested-share-token"
    configureRedaction({ shareToken: token })
    const nested = `https://app.example/?redirect=https%3A%2F%2Fpreview.vercel.app%2F%3F_vercel_share%3D${token}`
    const redacted = redactSensitiveText(nested)
    expectNoTokenLeak(redacted, token)
    expect(redacted).toMatch(/_vercel_share%3DREDACTED|%5Fvercel%5Fshare%3DREDACTED/i)
  })

  it("redacts x-vercel-protection-bypass as a query param", () => {
    const token = "Kq9mZ2pLsecret"
    configureRedaction({ bypassSecret: token })
    const url = `https://preview.vercel.app/?x-vercel-protection-bypass=${token}`
    expect(redactUrl(url)).toBe(
      "https://preview.vercel.app/?x-vercel-protection-bypass=REDACTED",
    )
    expectNoTokenLeak(redactSensitiveText(url), token)
  })

  it("redacts bypass header names and values from log lines", () => {
    const token = "my-secret-key"
    configureRedaction({ bypassSecret: token })
    const line = `requestfailed: x-vercel-protection-bypass: ${token} applied`
    const redacted = redactSensitiveText(line)
    expect(redacted).toContain("x-vercel-protection-bypass: REDACTED")
    expectNoTokenLeak(redacted, token)
  })

  it("redacts bare bypass secret and share token literals in all encoded forms", () => {
    const bypass = "bare/bypass+value"
    const share = "bare-share-value"
    configureRedaction({ bypassSecret: bypass, shareToken: share })
    for (const sample of [
      share,
      bypass,
      encodeURIComponent(bypass),
      encodeURIComponent(encodeURIComponent(bypass)),
      Buffer.from(bypass, "utf8").toString("base64"),
    ]) {
      expectNoTokenLeak(redactSensitiveText(sample), bypass.length >= 6 ? bypass : share)
    }
    expectNoTokenLeak(redactSensitiveText(`token ${share} end`), share)
    expect(redactSensitiveText(bypass)).toBe("REDACTED")
  })

  it("redacts bypass secret env echoes", () => {
    const token = "shhh-long-enough"
    configureRedaction({ bypassSecret: token })
    const redacted = redactSensitiveText(`VERCEL_AUTOMATION_BYPASS_SECRET=${token}`)
    expect(redacted).toBe("VERCEL_AUTOMATION_BYPASS_SECRET=REDACTED")
    expectNoTokenLeak(redacted, token)
  })
})
