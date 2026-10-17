import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BlobNotFoundError } from "@vercel/blob"
import { blobClient } from "@/lib/blob-client"
import { emptyHourAdjustments, parseHourAdjustments, type HourAdjustmentsDoc } from "@/lib/hour-adjustments"
import { githubStore, githubStoreEnabled } from "@/lib/github-store"

const PATHNAME = "hujiang/hour-adjustments.json"
const FILE = path.join(process.env.TMPDIR || "/tmp", "hujiang-cover", "hour-adjustments.json")

const globalStore = globalThis as typeof globalThis & { __hujiangHourAdjust?: HourAdjustmentsDoc }

function memory() {
  if (!globalStore.__hujiangHourAdjust) globalStore.__hujiangHourAdjust = emptyHourAdjustments()
  return globalStore.__hujiangHourAdjust
}

function parseRaw(raw: string): HourAdjustmentsDoc {
  try {
    return parseHourAdjustments(JSON.parse(raw))
  } catch {
    return emptyHourAdjustments()
  }
}

async function readFileDoc(): Promise<HourAdjustmentsDoc> {
  try {
    return parseRaw(await readFile(FILE, "utf8"))
  } catch {
    return emptyHourAdjustments()
  }
}

async function writeFileDoc(doc: HourAdjustmentsDoc) {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(doc))
}

async function readShared(): Promise<HourAdjustmentsDoc> {
  if (githubStoreEnabled()) {
    try {
      const raw = await githubStore.read(PATHNAME)
      return raw == null ? emptyHourAdjustments() : parseRaw(raw)
    } catch (error) {
      console.error("hour-adjustments github read skipped", error)
      return readFileDoc()
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const result = await blobClient.get(PATHNAME, { access: "private", useCache: false })
      if (!result || result.statusCode !== 200 || !result.stream) return emptyHourAdjustments()
      return parseRaw(await new Response(result.stream).text())
    } catch (error) {
      if (error instanceof BlobNotFoundError) return emptyHourAdjustments()
      console.error("hour-adjustments blob read skipped", error)
      const mem = memory()
      if (Object.keys(mem.adjustments).length || mem.exclusions.length) return mem
      return readFileDoc()
    }
  }
  const fileDoc = await readFileDoc()
  if (Object.keys(fileDoc.adjustments).length || fileDoc.exclusions.length) return fileDoc
  return memory()
}

async function writeShared(doc: HourAdjustmentsDoc) {
  const body = JSON.stringify(doc)
  if (githubStoreEnabled()) {
    try {
      await githubStore.write(PATHNAME, body)
      return
    } catch (error) {
      console.error("hour-adjustments github write skipped", error)
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
      console.error("hour-adjustments blob write skipped", error)
      await writeFileDoc(doc)
      return
    }
  }
  await writeFileDoc(doc)
}

export async function readHourAdjustments(): Promise<HourAdjustmentsDoc> {
  const doc = await readShared()
  memory().adjustments = doc.adjustments
  memory().exclusions = doc.exclusions
  return doc
}

export async function writeHourAdjustments(doc: HourAdjustmentsDoc): Promise<HourAdjustmentsDoc> {
  const next = parseHourAdjustments(doc)
  memory().adjustments = next.adjustments
  memory().exclusions = next.exclusions
  try {
    await writeShared(next)
  } catch (error) {
    console.error("hour-adjustments write failed; kept in memory", error)
  }
  return next
}
