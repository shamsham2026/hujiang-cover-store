import { createHmac, timingSafeEqual } from "node:crypto"
import type { Plan } from "@/lib/types"

export type ConfirmPayload = {
  v: 1
  id: string
  plan: Plan
  related: Plan[]
  gasUrl: string
}

function secret() {
  return process.env.CONFIRM_SECRET || "hujiang-cover-confirm-v1"
}

export function signConfirmToken(payload: ConfirmPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", secret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifyConfirmToken(token: string): ConfirmPayload | null {
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", secret()).update(body).digest("base64url")
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConfirmPayload
    if (payload.v !== 1 || !payload.plan || !payload.id) return null
    if (!Array.isArray(payload.related)) payload.related = []
    if (typeof payload.gasUrl !== "string") payload.gasUrl = ""
    return payload
  } catch {
    return null
  }
}
