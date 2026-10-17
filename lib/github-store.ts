const API = "https://api.github.com"

export type GitHubStoreTarget = { token: string; owner: string; repo: string }

/** Private Contents API store. `GITHUB_STORE_REPO=owner/name` overrides the split owner/repo vars. */
export function githubStoreTarget(): GitHubStoreTarget | null {
  const token = process.env.GITHUB_STORE_TOKEN?.trim()
  if (!token) return null
  const repoEnv = (process.env.GITHUB_STORE_REPO || "hujiang-cover-store").trim()
  const ownerEnv = process.env.GITHUB_STORE_OWNER?.trim()
  if (repoEnv.includes("/")) {
    const slash = repoEnv.indexOf("/")
    const owner = repoEnv.slice(0, slash).trim()
    const repo = repoEnv.slice(slash + 1).trim()
    if (!owner || !repo || repo.includes("/")) return null
    return { token, owner, repo }
  }
  return { token, owner: ownerEnv || "shamsham2026", repo: repoEnv }
}

export function githubStoreEnabled() {
  return githubStoreTarget() !== null
}

function errorMessage(status: number, body: unknown) {
  const message = body && typeof body === "object" && "message" in body ? String((body as { message?: unknown }).message || "") : ""
  return `GitHub store ${status}${message ? `: ${message}` : ""}`
}

function decodeContent(json: unknown) {
  if (!json || typeof json !== "object") throw new Error("GitHub store 回應不完整")
  const record = json as { content?: unknown; encoding?: unknown }
  if (typeof record.content !== "string") throw new Error("GitHub store 回應不完整")
  if (record.encoding === "none") return record.content
  return Buffer.from(record.content.replace(/\n/g, ""), "base64").toString("utf8")
}

async function githubFetch(target: GitHubStoreTarget, pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${target.token}`)
  headers.set("Accept", "application/vnd.github+json")
  headers.set("X-GitHub-Api-Version", "2022-11-28")
  headers.set("User-Agent", "hujiang-cover")
  if (init.body) headers.set("Content-Type", "application/json")
  const path = pathname.split("/").map((part) => encodeURIComponent(part)).join("/")
  return githubStore.fetch(`${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path}`, {
    ...init,
    headers,
  })
}

async function readMeta(target: GitHubStoreTarget, pathname: string): Promise<{ sha: string; text: string } | null> {
  const response = await githubFetch(target, pathname)
  if (response.status === 404) return null
  const json = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorMessage(response.status, json))
  const sha = json && typeof json === "object" ? (json as { sha?: unknown }).sha : undefined
  if (typeof sha !== "string" || !sha) throw new Error("GitHub store 回應不完整")
  return { sha, text: decodeContent(json) }
}

async function read(pathname: string): Promise<string | null> {
  const target = githubStoreTarget()
  if (!target) throw new Error("GITHUB_STORE_TOKEN 未設定")
  const meta = await readMeta(target, pathname)
  return meta ? meta.text : null
}

async function write(pathname: string, text: string): Promise<void> {
  const target = githubStoreTarget()
  if (!target) throw new Error("GITHUB_STORE_TOKEN 未設定")
  const content = Buffer.from(text, "utf8").toString("base64")
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const meta = await readMeta(target, pathname)
    const payload: { message: string; content: string; sha?: string } = {
      message: `update ${pathname}`,
      content,
    }
    if (meta?.sha) payload.sha = meta.sha
    const response = await githubFetch(target, pathname, { method: "PUT", body: JSON.stringify(payload) })
    if (response.ok) return
    if (response.status === 409 && attempt === 0) continue
    const json = await response.json().catch(() => null)
    throw new Error(errorMessage(response.status, json))
  }
}

/** Mutable so route tests can stub Contents API calls without hitting GitHub. */
export const githubStore = {
  read,
  write,
  fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch,
}
