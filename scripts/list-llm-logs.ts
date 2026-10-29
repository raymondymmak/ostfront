import { list } from "@vercel/blob"

const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
if (!token) {
  console.error("Set BLOB_READ_WRITE_TOKEN to list LLM logs.")
  process.exit(1)
}

const prefix = process.argv[2]?.trim() || "llm-log/"
let cursor: string | undefined
let count = 0

do {
  const page = await list({ prefix, cursor, token, limit: 100 })
  for (const blob of page.blobs) {
    count += 1
    const when = blob.uploadedAt instanceof Date ? blob.uploadedAt.toISOString() : String(blob.uploadedAt)
    console.log(`${when}  ${blob.pathname}`)
  }
  cursor = page.hasMore ? page.cursor : undefined
} while (cursor)

if (count === 0) console.log(`No blobs under ${prefix}`)
else console.log(`${count} blob${count === 1 ? "" : "s"} under ${prefix}`)
