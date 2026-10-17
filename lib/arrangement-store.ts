import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BlobNotFoundError } from "@vercel/blob"
import { blobClient } from "@/lib/blob-client"
import {
  emptyArrangementDoc,
  parseArrangementDoc,
  removePlan,
  upsertPlan,
  archivePlans,
  isKnownPlanId,
  withKnownArrangements,
  type ArrangementDoc,
} from "@/lib/arrangement-doc"
import { sortPlansByMovementDate } from "@/lib/arrangement-list"
import { githubStore, githubStoreEnabled } from "@/lib/github-store"
import type { Plan } from "@/lib/types"

const PATHNAME = "hujiang/arrangements.json"
const FILE = path.join(process.env.TMPDIR || "/tmp", "hujiang-cover", "arrangements.json")

function sameDoc(left: ArrangementDoc, right: ArrangementDoc) {
  return (
    left.version === right.version &&
    JSON.stringify(left.plans) === JSON.stringify(right.plans) &&
    JSON.stringify(left.archived || []) === JSON.stringify(right.archived || [])
  )
}

async function readBlob(): Promise<ArrangementDoc | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null
  try {
    const result = await blobClient.get(PATHNAME, { access: "private", useCache: false })
    if (!result || result.statusCode !== 200 || !result.stream) return emptyArrangementDoc()
    return parseArrangementDoc(await new Response(result.stream).text())
  } catch (error) {
    if (error instanceof BlobNotFoundError) return emptyArrangementDoc()
    throw error
  }
}

async function writeBlob(doc: ArrangementDoc) {
  await blobClient.put(PATHNAME, JSON.stringify(doc), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  })
}

async function readFileDoc(): Promise<ArrangementDoc> {
  try {
    return parseArrangementDoc(await readFile(FILE, "utf8"))
  } catch {
    return emptyArrangementDoc()
  }
}

async function writeFileDoc(doc: ArrangementDoc) {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(doc))
}

async function readStored(): Promise<ArrangementDoc> {
  if (githubStoreEnabled()) {
    try {
      const raw = await githubStore.read(PATHNAME)
      return raw == null ? emptyArrangementDoc() : parseArrangementDoc(raw)
    } catch (error) {
      console.error("arrangement github read skipped", error)
      return readFileDoc()
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      return (await readBlob()) ?? emptyArrangementDoc()
    } catch (error) {
      console.error("arrangement blob read skipped", error)
      return readFileDoc()
    }
  }
  return readFileDoc()
}

async function writeStored(doc: ArrangementDoc) {
  if (githubStoreEnabled()) {
    try {
      await githubStore.write(PATHNAME, JSON.stringify(doc))
      return
    } catch (error) {
      console.error("arrangement github write skipped", error)
      await writeFileDoc(doc)
      return
    }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await writeBlob(doc)
      return
    } catch (error) {
      console.error("arrangement blob write skipped", error)
      await writeFileDoc(doc)
      return
    }
  }
  await writeFileDoc(doc)
}

async function migrateAndRead(): Promise<ArrangementDoc> {
  const stored = await readStored()
  const next = withKnownArrangements(stored)
  if (!sameDoc(stored, next)) {
    try {
      await writeStored(next)
    } catch (error) {
      console.error("arrangement store sync skipped", error)
    }
  }
  return next
}

/** 活躍「本次安排」——進行中／未確認完。 */
export async function readArrangements(): Promise<Plan[]> {
  const next = await migrateAndRead()
  return sortPlansByMovementDate(next.plans)
}

/** 歷史歸檔——已確認／bake-in；俾 /records 重下，唔入 /arrange／/slip。 */
export async function readArchivedArrangements(): Promise<Plan[]> {
  const next = await migrateAndRead()
  return sortPlansByMovementDate(next.archived || [])
}

export async function upsertPlans(plans: Plan[]) {
  let doc = withKnownArrangements(await readStored())
  for (const plan of plans) {
    if (!plan?.id) continue
    // known／示範歷史只入 archived，唔准寫返活躍「本次安排」
    if (isKnownPlanId(plan.id)) {
      doc = archivePlans(doc, [plan])
      continue
    }
    doc = upsertPlan(doc, plan)
  }
  await writeStored(doc)
  return doc.plans
}

/** 確認成功：移入 archived 並撤出活躍。 */
export async function archiveConfirmedPlans(plans: Plan[]) {
  const moving = plans.filter((plan) => plan?.id)
  if (!moving.length) return { plans: [] as Plan[], archived: [] as Plan[] }
  const doc = archivePlans(withKnownArrangements(await readStored()), moving)
  await writeStored(doc)
  return { plans: doc.plans, archived: doc.archived }
}

export async function deleteArrangement(id: string) {
  const doc = removePlan(withKnownArrangements(await readStored()), id)
  await writeStored(doc)
  return doc.plans
}
