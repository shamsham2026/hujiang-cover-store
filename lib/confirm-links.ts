import { randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BlobNotFoundError } from "@vercel/blob"
import { blobClient } from "@/lib/blob-client"
import { confirmCodeFromBytes, isConfirmCode } from "@/lib/confirm-code"
import { githubStore, githubStoreEnabled } from "@/lib/github-store"
import type { ConfirmPayload } from "@/lib/confirm-token"

const PATHNAME = "hujiang/confirm-links.json"
const FILE = path.join(process.env.TMPDIR || "/tmp", "hujiang-cover", "confirm-links.json")

type LinkDoc = { links: Record<string, ConfirmPayload> }

function emptyDoc(): LinkDoc {
  return { links: {} }
}

function parseDoc(raw: string): LinkDoc {
  try {
    const value = JSON.parse(raw) as { links?: Record<string, ConfirmPayload> }
    const links = value.links && typeof value.links === "object" ? value.links : {}
    return { links }
  } catch {
    return emptyDoc()
  }
}

async function readFileDoc(): Promise<LinkDoc> {
  try {
    return parseDoc(await readFile(FILE, "utf8"))
  } catch {
    return emptyDoc()
  }
}

async function writeFileDoc(doc: LinkDoc) {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(doc))
}

async function readDoc(): Promise<LinkDoc> {
  if (githubStoreEnabled()) {
    try {
      const raw = await githubStore.read(PATHNAME)
      return raw == null ? emptyDoc() : parseDoc(raw)
    } catch (error) {
      console.error("confirm-links github read skipped", error)
      return readFileDoc()
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const result = await blobClient.get(PATHNAME, { access: "private", useCache: false })
      if (!result || result.statusCode !== 200 || !result.stream) return emptyDoc()
      return parseDoc(await new Response(result.stream).text())
    } catch (error) {
      if (error instanceof BlobNotFoundError) return emptyDoc()
      console.error("confirm-links blob read skipped", error)
      return readFileDoc()
    }
  }
  return readFileDoc()
}

async function writeDoc(doc: LinkDoc) {
  const body = JSON.stringify(doc)
  if (githubStoreEnabled()) {
    try {
      await githubStore.write(PATHNAME, body)
      return
    } catch (error) {
      console.error("confirm-links github write skipped", error)
      await writeFileDoc(doc)
      return
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await blobClient.put(PATHNAME, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      })
      return
    } catch (error) {
      console.error("confirm-links blob write skipped", error)
      await writeFileDoc(doc)
      return
    }
  }
  await writeFileDoc(doc)
}

export async function issueConfirmCode(payload: ConfirmPayload) {
  const doc = await readDoc()
  const existing = Object.entries(doc.links).find(([, item]) => item.id === payload.id)
  if (existing) {
    doc.links[existing[0]] = payload
    await writeDoc(doc)
    return existing[0]
  }
  let code = confirmCodeFromBytes(randomBytes(6))
  while (doc.links[code]) code = confirmCodeFromBytes(randomBytes(6))
  doc.links[code] = payload
  await writeDoc(doc)
  return code
}

export async function readConfirmCode(code: string): Promise<ConfirmPayload | null> {
  if (!isConfirmCode(code)) return null
  const doc = await readDoc()
  return doc.links[code] || null
}
