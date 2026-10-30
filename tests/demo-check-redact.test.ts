import { describe, expect, it } from "vitest"
import { redactSensitiveText, redactUrl } from "../scripts/demo-check-redact.mjs"

describe("demo-check redaction", () => {
  it("redacts _vercel_share query values in URLs and text", () => {
    const raw =
      "https://preview.vercel.app/?_vercel_share=secret-token-abc&foo=1"
    expect(redactUrl(raw)).toBe("https://preview.vercel.app/?_vercel_share=REDACTED&foo=1")
    expect(redactSensitiveText(`open ${raw}`)).toContain("_vercel_share=REDACTED")
    expect(redactSensitiveText(`open ${raw}`)).not.toContain("secret-token-abc")
  })

  it("redacts bypass header names and values from log lines", () => {
    const line = 'requestfailed: x-vercel-protection-bypass: my-secret-key applied'
    const redacted = redactSensitiveText(line)
    expect(redacted).toContain("x-vercel-protection-bypass: REDACTED")
    expect(redacted).not.toContain("my-secret-key")
  })

  it("redacts bypass secret env echoes", () => {
    const line = "VERCEL_AUTOMATION_BYPASS_SECRET=shhh"
    expect(redactSensitiveText(line)).toBe("VERCEL_AUTOMATION_BYPASS_SECRET=REDACTED")
  })
})
