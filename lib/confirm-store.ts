import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BlobNotFoundError } from "@vercel/blob"
import { blobClient } from "@/lib/blob-client"
import type { InboxItem } from "@/lib/confirmations"
import { githubStore, githubStoreEnabled } from "@/lib/github-store"

const PATHNAME = "hujiang/confirmations.json"
const FILE = path.join(process.env.TMPDIR || "/tmp", "hujiang-cover", "confirmations.json")

type Memory = { items: InboxItem[] }

const globalStore = globalThis as typeof globalThis & { __hujiangConfirm?: Memory }

function memory() {
  if (!globalStore.__hujiangConfirm) globalStore.__hujiangConfirm = { items: [] }
  return globalStore.__hujiangConfirm
}

function parseItems(raw: string): InboxItem[] {
  try {
    const value = JSON.parse(raw) as { items?: InboxItem[] } | InboxItem[]
    const items = Array.isArray(value) ? value : value.items
    return Array.isArray(items) ? items.filter((item) => item && typeof item.id === "string" && typeof item.who === "string") : []
  } catch {
    return []
  }
}

export function upsertConfirmationList(items: InboxItem[], item: InboxItem) {
  return [item, ...items.filter((row) => row.id !== item.id)].slice(0, 80)
}

async function readFileDoc(): Promise<InboxItem[]> {
  try {
    return parseItems(await readFile(FILE, "utf8"))
  } catch {
    return []
  }
}

async function writeFileDoc(items: InboxItem[]) {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify({ items }))
}

async function readShared(): Promise<InboxItem[]> {
  if (githubStoreEnabled()) {
    try {
      const raw = await githubStore.read(PATHNAME)
      return raw == null ? [] : parseItems(raw)
    } catch (error) {
      console.error("confirmations github read skipped", error)
      return readFileDoc()
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const result = await blobClient.get(PATHNAME, { access: "private", useCache: false })
      if (!result || result.statusCode !== 200 || !result.stream) return []
      return parseItems(await new Response(result.stream).text())
    } catch (error) {
      if (error instanceof BlobNotFoundError) return []
      console.error("confirmations blob read skipped", error)
      return memory().items.length ? memory().items : readFileDoc()
    }
  }
  const fileItems = await readFileDoc()
  if (fileItems.length) return fileItems
  return memory().items
}

async function writeShared(items: InboxItem[]) {
  const body = JSON.stringify({ items })
  if (githubStoreEnabled()) {
    try {
      await githubStore.write(PATHNAME, body)
      return
    } catch (error) {
      console.error("confirmations github write skipped", error)
      await writeFileDoc(items)
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
      console.error("confirmations blob write skipped", error)
      await writeFileDoc(items)
      return
    }
  }
  await writeFileDoc(items)
}

export async function readStoredConfirmations() {
  const items = await readShared()
  memory().items = items
  return items
}

export async function storeConfirmation(item: InboxItem) {
  const next = upsertConfirmationList(await readShared(), item)
  memory().items = next
  try {
    await writeShared(next)
  } catch (error) {
    // Never fail confirm UX on store write; memory still holds this instance.
    console.error("confirmations write failed; kept in memory", error)
  }
  return item
}

export async function storedConfirmation(id: string) {
  return (await readStoredConfirmations()).find((item) => item.id === id) || null
}
