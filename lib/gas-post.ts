export type GasResult = {
  success?: boolean
  already?: boolean
  applied?: boolean
  message?: string
  error?: string
  items?: unknown
  count?: number
  confirmation?: unknown
  raw?: string
}

export async function postGas(url: string, payload: unknown): Promise<GasResult> {
  if (!url.startsWith("https://script.google.com/")) {
    return { success: false, message: "沒有可用的網頁應用程式網址。" }
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload ?? {}),
    redirect: "follow",
  })
  const text = await response.text()
  try {
    return JSON.parse(text) as GasResult
  } catch {
    return { success: false, message: "試算表沒有回傳可讀的結果。", raw: text.slice(0, 180) }
  }
}

export function gasUrlFromEnv(saved = "") {
  const envUrl = process.env.GAS_WEB_APP_URL || ""
  const url = envUrl || saved
  return url.startsWith("https://script.google.com/") ? url : ""
}
