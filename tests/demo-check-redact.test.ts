import { describe, expect, it } from "vitest"
import {
  configureRedaction,
  redactSensitiveText,
  redactUrl,
} from "../scripts/demo-check-redact.mjs"

describe("demo-check redaction", () => {
  it("redacts _vercel_share query values in URLs and text", () => {
    configureRedaction({ shareToken: "secret-token-abc" })
    const raw =
      "https://preview.vercel.app/?_vercel_share=secret-token-abc&foo=1"
    expect(redactUrl(raw)).toBe("https://preview.vercel.app/?_vercel_share=REDACTED&foo=1")
    expect(redactSensitiveText(`open ${raw}`)).toContain("_vercel_share=REDACTED")
    expect(redactSensitiveText(`open ${raw}`)).not.toContain("secret-token-abc")
  })

  it("redacts URL-encoded share tokens inside redirect query params", () => {
    configureRedaction({ shareToken: "nested-share-token" })
    const nested =
      "https://app.example/?redirect=https%3A%2F%2Fpreview.vercel.app%2F%3F_vercel_share%3Dnested-share-token"
    const redacted = redactSensitiveText(nested)
    expect(redacted).not.toContain("nested-share-token")
    expect(redacted).toMatch(/_vercel_share%3DREDACTED|%5Fvercel%5Fshare%3DREDACTED/i)
  })

  it("redacts x-vercel-protection-bypass as a query param", () => {
    configureRedaction({ bypassSecret: "bypass-query-secret" })
    const url = "https://preview.vercel.app/?x-vercel-protection-bypass=bypass-query-secret"
    expect(redactUrl(url)).toBe(
      "https://preview.vercel.app/?x-vercel-protection-bypass=REDACTED",
    )
    expect(redactSensitiveText(url)).not.toContain("bypass-query-secret")
  })

  it("redacts bypass header names and values from log lines", () => {
    configureRedaction({ bypassSecret: "my-secret-key" })
    const line = "requestfailed: x-vercel-protection-bypass: my-secret-key applied"
    const redacted = redactSensitiveText(line)
    expect(redacted).toContain("x-vercel-protection-bypass: REDACTED")
    expect(redacted).not.toContain("my-secret-key")
  })

  it("redacts bare bypass secret and share token literals", () => {
    configureRedaction({
      bypassSecret: "bare/bypass+value",
      shareToken: "bare-share-value",
    })
    expect(redactSensitiveText("token bare-share-value end")).not.toContain("bare-share-value")
    expect(redactSensitiveText("bare/bypass+value")).toBe("REDACTED")
    expect(redactSensitiveText(encodeURIComponent("bare/bypass+value"))).toBe("REDACTED")
  })

  it("redacts bypass secret env echoes", () => {
    configureRedaction({ bypassSecret: "shhh" })
    expect(redactSensitiveText("VERCEL_AUTOMATION_BYPASS_SECRET=shhh")).toBe(
      "VERCEL_AUTOMATION_BYPASS_SECRET=REDACTED",
    )
  })
})
