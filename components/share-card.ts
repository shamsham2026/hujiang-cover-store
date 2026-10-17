import { confirmationCard, type ConfirmationCard } from "@/lib/card"
import { formPdfPage, noticePdfPage, pdfFromJpegs } from "@/lib/form-pdf"
import { classFormSheets, formSheet, type FormSheet } from "@/lib/form-sheet"
import type { Plan, SchoolData } from "@/lib/types"


/** Sham 檔名：日-月-年-調課安排／代課安排（真 Unicode NFC；唔 encodeURIComponent／唔 TextEncoder→fromCharCode）。 */
function noticeDateStamp(date: string) {
  const raw = (date || "").trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw)
  if (dmy) return raw
  return raw || "安排"
}

function noticeKindTitle(plan: Plan, related: Plan[] = []) {
  const title = confirmationCard(plan, related).title
  return title === "代課安排" ? "代課安排" : "調課安排"
}

/** 例：29-09-2026-調課安排.pdf — 真 Unicode NFC 字串（codepoints 調 U+8ABF…）。 */
export function noticeFileName(plan: Plan, related: Plan[] = [], ext: "pdf" | "png" = "pdf") {
  const name = `${noticeDateStamp(plan.date)}-${noticeKindTitle(plan, related)}.${ext}`
  return name.normalize("NFC")
}

/** RFC 5987 Content-Disposition（伺服器下載用）。ASCII fallback + filename* UTF-8。
 *  例：attachment; filename="29-09-2026.pdf"; filename*=UTF-8''29-09-2026-%E8%AA%BF%E8%AA%B2%E5%AE%89%E6%8E%92.pdf
 */
export function contentDispositionAttachment(filename: string) {
  const nfc = filename.normalize("NFC")
  // 例：filename="29-09-2026.pdf"; filename*=UTF-8''29-09-2026-%E8%AA%BF…pdf
  const ext = /\.(pdf|png)$/i.exec(nfc)?.[0]?.toLowerCase() || ".pdf"
  const m = /^(\d{2}-\d{2}-\d{4})/.exec(nfc)
  const ascii = `${m ? m[1] : "notice"}${ext}`
  const star = encodeURIComponent(nfc).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase())
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`
}

/** 建立分享／下載用 File：真 Unicode 名，唔好拉丁碼亂碼。 */
function noticeFileFromBlob(blob: Blob, filename: string, mime: string) {
  const name = filename.normalize("NFC")
  // 禁止把 UTF-8 bytes 當 Latin-1 字串塞入 File.name（會令 WhatsApp 顯示 èª¿…）
  if (/èª[¿²]|å®|æŽ/.test(name)) {
    console.warn("[noticeFile] filename looks mojibake", name)
  }
  return new File([blob], name, { type: mime, lastModified: Date.now() })
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  // <a download> 必須直接用 Unicode；唔好 encodeURIComponent
  const safeName = filename.normalize("NFC")
  link.href = url
  link.setAttribute("download", safeName)
  link.download = safeName
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ""
  for (const char of text) {
    const next = line + char
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [""]
}

async function fontFamily() {
  await document.fonts.ready
  const family = getComputedStyle(document.body).fontFamily || '"Noto Sans TC", sans-serif'
  try {
    await document.fonts.load(`700 32px ${family}`)
    await document.fonts.load(`500 20px ${family}`)
    await document.fonts.load(`400 18px ${family}`)
  } catch {
    // The page already loads Noto Sans TC.
  }
  return family
}

async function noticeCanvas(plan: Plan, related: Plan[]) {
  const { canvas } = renderConfirmationCard(confirmationCard(plan, related), await fontFamily(), { withButton: true })
  return canvas
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const link = document.createElement("a")
  link.href = canvas.toDataURL("image/png")
  link.download = name.normalize("NFC")
  link.click()
}

export function noticeText(card: ConfirmationCard, _url?: string) {
  // 唔再夾入 /c URL，避免 WhatsApp 出綠字 link preview。
  const lines = card.rows.map((row) => `${row.period}　${row.content}　${row.teacher}`)
  return [card.title, card.dateLine, card.teacherLine, ...lines, card.footer].filter(Boolean).join("\n")
}

export async function buildNotice(plan: Plan, related: Plan[] = []) {
  const card = confirmationCard(plan, related)
  const canvas = await noticeCanvas(plan, related)
  return {
    card,
    dataUrl: canvas.toDataURL("image/png"),
    filename: noticeFileName(plan, related, "png"),
  }
}

export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 手機瀏覽器在等待網路之後會拒絕剪貼簿。
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "true")
    area.style.position = "fixed"
    area.style.top = "0"
    area.style.left = "0"
    area.style.fontSize = "16px"
    document.body.appendChild(area)
    area.focus()
    area.select()
    const copied = document.execCommand("copy")
    area.remove()
    return copied
  } catch {
    return false
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a")
  link.href = dataUrl
  link.download = filename.normalize("NFC")
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** @deprecated 勿再用於通知：會令 WhatsApp 出 URL preview。請用 shareNoticeDataUrl／sharePlanCard。 */
export function whatsAppUrl(text: string) {
  // 剝走 http(s) 連結，避免誤傳 /c short link。
  const cleaned = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^https?:\/\//i.test(line))
    .join("\n")
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(cleaned || text)}`
}

/** 分享通知卡 PNG（檔案），唔傳 URL。 */
export async function shareNoticeDataUrl(
  dataUrl: string,
  filename: string,
  title = "調課安排",
  text = "請相關同事確認以上安排",
) {
  const blob = await (await fetch(dataUrl)).blob()
  const fname = (filename || "調課安排.png").normalize("NFC")
  const file = noticeFileFromBlob(blob, fname, blob.type || "image/png")
  const canShare =
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }))
  if (canShare) {
    try {
      // title/text 帶正確中文檔名（WhatsApp 收 file 時或會忽略 text，但仍試）
      await navigator.share({ files: [file], title: title || fname, text: `${fname}\n${text}` })
      return "shared" as const
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "aborted" as const
    }
  }
  downloadDataUrl(dataUrl, fname)
  return "downloaded" as const
}

/** 建立通知卡 PDF Blob（含綠掣 Link）。 */
export async function buildNoticePdfBlob(
  plan: Plan,
  related: Plan[] = [],
  confirmUrl?: string,
) {
  const card = confirmationCard(plan, related)
  const family = await fontFamily()
  const { canvas, buttonBounds } = renderConfirmationCard(card, family, { withButton: true })
  const links = confirmUrl && buttonBounds ? [{ url: confirmUrl, ...buttonBounds }] : []
  const page = noticePdfPage(canvas.width, canvas.height)
  const pdf = pdfFromJpegs(
    [{ jpeg: await canvasJpeg(canvas), width: canvas.width, height: canvas.height, links }],
    page,
  )
  const filename = noticeFileName(plan, related, "pdf")
  const blob = new Blob([pdf], { type: "application/pdf" })
  return { blob, filename, card }
}

/** 分享通知卡 PDF 檔（優先）；唔得就分享 PNG；再唔得就下載 PDF。絕唔 share /c URL。 */
export async function shareNoticePdf(
  plan: Plan,
  related: Plan[] = [],
  confirmUrl?: string,
) {
  const { blob, filename, card } = await buildNoticePdfBlob(plan, related, confirmUrl)
  const nfcName = filename.normalize("NFC")
  // 先下載一份真中文檔名（Safari／Chrome download 屬性會保留 調課安排；WhatsApp 附加檔案先唔亂碼）
  triggerBlobDownload(blob, nfcName)
  const file = noticeFileFromBlob(blob, nfcName, "application/pdf")
  if (file.name !== nfcName) {
    console.warn("[shareNoticePdf] File.name mismatch", file.name, nfcName)
  }
  const shareText = `${nfcName}\n${card.footer}`
  const canSharePdf =
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }))
  if (canSharePdf) {
    try {
      await navigator.share({ files: [file], title: nfcName, text: shareText })
      // shared = 系統分享已叫起；同時已下載正確中文檔名
      return "shared" as const
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "aborted" as const
    }
  }
  // 無 Web Share 或失敗：正確中文檔名已下載
  return "downloaded" as const
}

export async function downloadPlanCard(plan: Plan, _data: SchoolData, related: Plan[] = []) {
  const card = confirmationCard(plan, related)
  const canvas = await noticeCanvas(plan, related)
  downloadCanvas(canvas, noticeFileName(plan, related, "png"))
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92))
  if (!blob) throw new Error("無法建立調課紙 PDF")
  return new Uint8Array(await blob.arrayBuffer())
}

/** 正式 A4 調課紙 PDF（校長簽署表）；列印預覽仍用 FormPreview。 */
export async function downloadSheetsPdf(sheets: FormSheet[]) {
  if (!sheets.length) throw new Error("沒有可列印的調課紙")
  const family = await fontFamily()
  const page = formPdfPage()
  const pages = []
  for (const sheet of sheets) {
    const { canvas, buttonBounds } = renderFormImage(sheet, family)
    const links =
      sheet.confirmUrl && buttonBounds
        ? [{ url: sheet.confirmUrl, ...buttonBounds }]
        : []
    pages.push({ jpeg: await canvasJpeg(canvas), width: canvas.width, height: canvas.height, links })
  }
  const pdf = pdfFromJpegs(pages, page)
  const file = new Blob([pdf], { type: "application/pdf" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(file)
  const names = sheets.map((sheet) => sheet.className).filter(Boolean).join("-")
  link.href = url
  link.download = `${sheets[0].kind}-${names || "安排"}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 通知卡 PDF（似圖檔）：細張卡紙＋可撳「確認以上安排」。 */
export async function downloadNoticePdf(
  plan: Plan,
  related: Plan[] = [],
  confirmUrl?: string,
) {
  const card = confirmationCard(plan, related)
  const family = await fontFamily()
  const { canvas, buttonBounds } = renderConfirmationCard(card, family, { withButton: true })
  const links =
    confirmUrl && buttonBounds ? [{ url: confirmUrl, ...buttonBounds }] : []
  const page = noticePdfPage(canvas.width, canvas.height)
  const pdf = pdfFromJpegs(
    [{ jpeg: await canvasJpeg(canvas), width: canvas.width, height: canvas.height, links }],
    page,
  )
  const file = new Blob([pdf], { type: "application/pdf" })
  triggerBlobDownload(file, noticeFileName(plan, related, "pdf"))
}

/** 多組通知卡合成一個 PDF（一組一頁）。 */
export async function downloadNoticePdfs(
  groups: { plan: Plan; related?: Plan[]; confirmUrl?: string }[],
) {
  if (!groups.length) throw new Error("沒有可下載的通知卡")
  const family = await fontFamily()
  const pages = []
  let firstTitle = "代課安排"
  let firstDate = ""
  for (const group of groups) {
    const card = confirmationCard(group.plan, group.related || [])
    if (!firstDate) {
      firstTitle = card.title
      firstDate = group.plan.date
    }
    const { canvas, buttonBounds } = renderConfirmationCard(card, family, { withButton: true })
    const links =
      group.confirmUrl && buttonBounds
        ? [{ url: group.confirmUrl, ...buttonBounds }]
        : []
    pages.push({
      jpeg: await canvasJpeg(canvas),
      width: canvas.width,
      height: canvas.height,
      links,
      page: noticePdfPage(canvas.width, canvas.height),
    })
  }
  // pdfFromJpegs uses one page size; use first card's page (similar sizes)
  const page = pages[0].page
  const pdf = pdfFromJpegs(
    pages.map(({ jpeg, width, height, links }) => ({ jpeg, width, height, links })),
    page,
  )
  const file = new Blob([pdf], { type: "application/pdf" })
  const kind = firstTitle === "代課安排" ? "代課安排" : "調課安排"
  triggerBlobDownload(file, `${noticeDateStamp(firstDate)}-${kind}.pdf`.normalize("NFC"))
}

export async function downloadPlanPdf(plan: Plan, related: Plan[] = [], confirmUrl?: string) {
  await downloadNoticePdf(plan, related, confirmUrl)
}

export async function sharePlanCard(plan: Plan, _data: SchoolData, related: Plan[] = []) {
  const card = confirmationCard(plan, related)
  const canvas = await noticeCanvas(plan, related)
  const name = noticeFileName(plan, related, "png")
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/png"))
  if (!blob) {
    downloadCanvas(canvas, name)
    return "downloaded" as const
  }
  const file = noticeFileFromBlob(blob, name, "image/png")
  const canShare = typeof navigator.share === "function" && (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }))
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: name, text: `${name}\n${card.footer}` })
      return "shared" as const
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "aborted" as const
    }
  }
  downloadCanvas(canvas, name)
  return "downloaded" as const
}

export type FormImageResult = {
  canvas: HTMLCanvasElement
  /** 「確定」掣喺 canvas 像素座標（同 canvas.width/height；origin 左上） */
  buttonBounds?: { x: number; y: number; w: number; h: number }
}

export type NoticeRenderOptions = {
  /** 底掣「確認以上安排」（圖／PDF 同款） */
  withButton?: boolean
}

export function renderConfirmationCard(
  card: ConfirmationCard,
  family = '"Noto Sans TC", sans-serif',
  options: NoticeRenderOptions = {},
): FormImageResult {
  const withButton = options.withButton !== false
  const width = 740
  const pad = 60
  const measure = document.createElement("canvas").getContext("2d")
  if (!measure) throw new Error("無法建立確認圖")
  measure.font = `500 19px ${family}`
  const contentWidth = width - pad * 2
  const colGap = contentWidth
  const columns = [colGap * 0.2, colGap * 0.48, colGap * 0.32]
  const rowHeights = card.rows.map((row) => {
    const lines = Math.max(
      wrap(measure, row.content, columns[1] - 28).length,
      wrap(measure, row.teacher, columns[2] - 28).length,
      1,
    )
    return Math.max(64, lines * 28 + 32)
  })
  const headerH = 58
  const titleBlock = 56
  const ruleGap = 22
  const metaGap = 48
  const tableTopGap = 28
  const afterTable = 48
  const footerH = 28
  const btnGap = 44
  const btnH = 52
  const bottomPad = 56
  const height =
    40 +
    titleBlock +
    ruleGap +
    metaGap +
    metaGap +
    tableTopGap +
    headerH +
    rowHeights.reduce((sum, value) => sum + value, 0) +
    afterTable +
    footerH +
    (withButton ? btnGap + btnH : 0) +
    bottomPad

  const canvas = document.createElement("canvas")
  const scale = 2
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("無法建立確認圖")
  ctx.scale(scale, scale)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)

  let y = 40
  const titleFont = `700 30px ${family}`
  ctx.font = titleFont
  const titleWidth = ctx.measureText(card.title).width
  const icon = 30
  const group = icon + 12 + titleWidth
  const groupX = (width - group) / 2
  drawDocument(ctx, groupX, y, icon)
  ctx.fillStyle = "#1a1a1a"
  ctx.font = titleFont
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillText(card.title, groupX + icon + 12, y + icon / 2)
  y += titleBlock

  ctx.strokeStyle = "#1a1a1a"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(width - pad, y)
  ctx.stroke()
  y += ruleGap

  ctx.font = `500 19px ${family}`
  ctx.fillStyle = "#1a1a1a"
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  drawCalendar(ctx, pad, y, 24)
  ctx.fillText(card.dateLine, pad + 34, y + 12)
  y += metaGap
  drawPerson(ctx, pad, y, 24)
  ctx.fillText(card.teacherLine, pad + 34, y + 12)
  y += metaGap

  y += tableTopGap - 16
  const headers = ["教節", "班級／內容", card.column]
  drawNoticeRow(ctx, family, pad, y, columns, headers, headerH, true, false)
  y += headerH
  card.rows.forEach((row, index) => {
    const rowHeight = rowHeights[index]
    drawNoticeRow(ctx, family, pad, y, columns, [row.period, row.content, row.teacher], rowHeight, false, true)
    y += rowHeight
  })

  y += afterTable
  ctx.fillStyle = "#8a8a8a"
  ctx.font = `500 16px ${family}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(card.footer, width / 2, y)
  y += footerH

  let buttonBounds: FormImageResult["buttonBounds"]
  if (withButton) {
    y += btnGap - 8
    const btnW = Math.min(380, contentWidth * 0.7)
    const btnX = (width - btnW) / 2
    const btnY = y
    roundRectPath(ctx, btnX, btnY, btnW, btnH, 12)
    ctx.fillStyle = "#0B6E4F"
    ctx.fill()
    ctx.fillStyle = "#ffffff"
    ctx.font = `700 20px ${family}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("確認以上安排", width / 2, btnY + btnH / 2)
    buttonBounds = {
      x: btnX * scale,
      y: btnY * scale,
      w: btnW * scale,
      h: btnH * scale,
    }
  }

  ctx.strokeStyle = "#1c1c1c"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(12, 12, width - 24, height - 24, 20)
  ctx.stroke()
  return { canvas, buttonBounds }
}

function drawNoticeRow(
  ctx: CanvasRenderingContext2D,
  family: string,
  x: number,
  y: number,
  columns: number[],
  cells: string[],
  height: number,
  header: boolean,
  emphasizeLast: boolean
) {
  let cursor = x
  cells.forEach((cell, index) => {
    const width = columns[index]
    ctx.fillStyle = header ? "#ececec" : "#ffffff"
    ctx.fillRect(cursor, y, width, height)
    ctx.strokeStyle = "#222222"
    ctx.lineWidth = 1
    ctx.strokeRect(cursor + 0.5, y + 0.5, width - 1, height - 1)
    const last = emphasizeLast && index === cells.length - 1
    ctx.fillStyle = last ? "#d50000" : "#1a1a1a"
    ctx.font = header || last ? `700 19px ${family}` : `500 19px ${family}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const lines = wrap(ctx, cell, width - 28)
    const start = y + height / 2 - ((lines.length - 1) * 24) / 2
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, cursor + width / 2, start + lineIndex * 24)
    })
    cursor += width
  })
}

function drawDocument(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = "#fff"
  ctx.strokeStyle = "#2b2b2b"
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.roundRect(1, 1, size * 0.68, size - 2, 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(4, 8)
  ctx.lineTo(size * 0.5, 8)
  ctx.moveTo(4, 13)
  ctx.lineTo(size * 0.42, 13)
  ctx.stroke()
  ctx.translate(size * 0.34, size * 0.42)
  ctx.rotate(-0.75)
  ctx.fillStyle = "#f2c14b"
  ctx.fillRect(0, 0, size * 0.46, 5)
  ctx.fillStyle = "#ef8b2c"
  ctx.beginPath()
  ctx.moveTo(size * 0.46, 0)
  ctx.lineTo(size * 0.58, 2.5)
  ctx.lineTo(size * 0.46, 5)
  ctx.fill()
  ctx.restore()
}

function drawCalendar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = "#ffffff"
  ctx.strokeStyle = "#333"
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.roundRect(1, 3, size - 2, size - 4, 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#e24b4b"
  ctx.fillRect(1, 3, size - 2, 6)
  ctx.strokeStyle = "#333"
  ctx.beginPath()
  ctx.moveTo(6, 1)
  ctx.lineTo(6, 6)
  ctx.moveTo(size - 7, 1)
  ctx.lineTo(size - 7, 6)
  ctx.moveTo(5, 13)
  ctx.lineTo(size - 5, 13)
  ctx.moveTo(size / 2, 10)
  ctx.lineTo(size / 2, size - 3)
  ctx.stroke()
  ctx.restore()
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = "#4b4b4b"
  ctx.beginPath()
  ctx.arc(size / 2, 7, 4.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(size / 2, 20, 7.2, Math.PI, 0)
  ctx.fill()
  ctx.restore()
}

export function renderFormImage(sheet: FormSheet, family = '"Noto Sans TC", sans-serif'): FormImageResult {
  const scale = Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2)
  const width = 640
  const pad = 18
  const crowded = sheet.headers.length > 5
  const textSize = crowded ? 11 : 13
  const measure = document.createElement("canvas").getContext("2d")
  if (!measure) throw new Error("無法建立調課紙圖片")
  const contentWidth = width - pad * 2
  const periodWidth = crowded ? 78 : 96
  const bodyWidth = contentWidth - periodWidth
  const colWidth = bodyWidth / Math.max(sheet.headers.length - 1, 1)
  measure.font = `500 ${textSize}px ${family}`
  const rowHeights = sheet.rows.map((row) => {
    const periodLines = 1 + (row.time ? 1 : 0)
    const cellLines = row.cells.map((cell) => wrap(measure, cell || " ", colWidth - 8).length)
    const lines = Math.max(periodLines, ...cellLines, 1)
    return Math.max(crowded ? 30 : 34, lines * (textSize + 4) + 8)
  })
  const headerHeight = crowded ? 28 : 32
  const meta = (sheet.className ? 26 : 0) + (sheet.kind === "代課安排" ? 26 : 0) + 26
  const confirmBlock = 172
  const contentHeight = 22 + 32 + meta + 10 + headerHeight + rowHeights.reduce((sum, value) => sum + value, 0) + 32 + (sheet.note ? 44 : 12) + (sheet.footer ? 24 : 8) + confirmBlock
  const height = Math.max(contentHeight, Math.ceil(width * 842 / 595))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("無法建立調課紙圖片")
  ctx.scale(scale, scale)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "#111111"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  let titleSize = crowded ? 16 : 20
  ctx.font = `700 ${titleSize}px ${family}`
  while (titleSize > 12 && ctx.measureText(sheet.title).width > contentWidth) {
    titleSize -= 1
    ctx.font = `700 ${titleSize}px ${family}`
  }
  ctx.fillText(sheet.title, width / 2, 28)

  let y = 58
  ctx.font = `500 16px ${family}`
  ctx.textAlign = "left"
  if (sheet.className) {
    drawLabeledBlank(ctx, pad + 80, y, "班別：", sheet.className, 180)
    y += 28
  }
  if (sheet.kind === "代課安排") {
    drawLabeledBlank(ctx, pad + 80, y, "日期：", sheet.dateLine, 280)
    y += 28
  }
  drawLabeledBlank(ctx, pad + 80, y, "原因：", sheet.reason, 320)
  y += 22

  drawFormRow(ctx, family, pad, y, periodWidth, colWidth, sheet.headers, headerHeight, true, textSize)
  y += headerHeight
  sheet.rows.forEach((row, index) => {
    const rowHeight = rowHeights[index]
    drawFormRow(ctx, family, pad, y, periodWidth, colWidth, [row.time ? `${row.period}\n${row.time}` : row.period, ...row.cells], rowHeight, false, textSize)
    y += rowHeight
  })

  y += 22
  drawLabeledBlank(ctx, pad, y, "校長簽署：", "", 180)
  y += 36
  if (sheet.note) {
    ctx.font = `400 13px ${family}`
    ctx.fillStyle = "#222222"
    ctx.textAlign = "center"
    const noteLines = wrap(ctx, sheet.note, contentWidth)
    noteLines.forEach((line) => {
      ctx.fillText(line, width / 2, y)
      y += 18
    })
  }
  if (sheet.footer) {
    ctx.fillStyle = "#222222"
    ctx.font = `500 15px ${family}`
    ctx.textAlign = "center"
    wrap(ctx, sheet.footer, contentWidth).forEach((line) => {
      ctx.fillText(line, width / 2, y)
      y += 20
    })
  }
  y += 28
  const button = drawConfirmBlock(ctx, family, pad, y, contentWidth, width, sheet.confirmWho || "")
  return {
    canvas,
    buttonBounds: {
      x: button.x * scale,
      y: button.y * scale,
      w: button.w * scale,
      h: button.h * scale,
    },
  }
}

/** Visual confirm UI for download PDF（同確認頁「你的名字」＋「確定」）；回傳「確定」掣邏輯座標 */
function drawConfirmBlock(
  ctx: CanvasRenderingContext2D,
  family: string,
  pad: number,
  y: number,
  contentWidth: number,
  width: number,
  who: string,
) {
  ctx.fillStyle = "#111111"
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.font = `500 16px ${family}`
  ctx.fillText("你的名字", pad, y)
  y += 28
  const inputH = 48
  const inputW = contentWidth
  ctx.fillStyle = "#ffffff"
  ctx.strokeStyle = "#222222"
  ctx.lineWidth = 1.5
  roundRectPath(ctx, pad, y, inputW, inputH, 10)
  ctx.fill()
  ctx.stroke()
  if (who) {
    ctx.fillStyle = "#111111"
    ctx.font = `500 18px ${family}`
    ctx.textAlign = "left"
    ctx.fillText(who, pad + 14, y + inputH / 2)
  }
  y += inputH + 18
  const btnH = 56
  const btnX = pad
  const btnY = y
  const btnW = contentWidth
  ctx.fillStyle = "#171717"
  roundRectPath(ctx, btnX, btnY, btnW, btnH, 10)
  ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.font = `700 20px ${family}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("確定", width / 2, btnY + btnH / 2)
  return { x: btnX, y: btnY, w: btnW, h: btnH }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawLabeledBlank(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string, blankWidth: number) {
  ctx.fillStyle = "#111111"
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillText(label, x, y)
  const labelWidth = ctx.measureText(label).width
  const start = x + labelWidth + 8
  ctx.textAlign = "center"
  ctx.fillText(value, start + blankWidth / 2, y - 2)
  ctx.beginPath()
  ctx.strokeStyle = "#111111"
  ctx.lineWidth = 1
  ctx.moveTo(start, y + 10)
  ctx.lineTo(start + blankWidth, y + 10)
  ctx.stroke()
}

function drawFormRow(
  ctx: CanvasRenderingContext2D,
  family: string,
  x: number,
  y: number,
  periodWidth: number,
  colWidth: number,
  cells: string[],
  height: number,
  header: boolean,
  textSize: number
) {
  let cursor = x
  cells.forEach((cell, index) => {
    const width = index === 0 ? periodWidth : colWidth
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(cursor, y, width, height)
    ctx.strokeStyle = "#111111"
    ctx.lineWidth = 1
    ctx.strokeRect(cursor + 0.5, y + 0.5, width - 1, height - 1)
    ctx.fillStyle = "#111111"
    ctx.font = header ? `700 ${textSize}px ${family}` : `500 ${textSize}px ${family}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const blocks = cell.split("\n")
    const lines = blocks.flatMap((block) => wrap(ctx, block || " ", width - 10))
    const start = y + height / 2 - ((lines.length - 1) * 16) / 2
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, cursor + width / 2, start + lineIndex * 16)
    })
    cursor += width
  })
}
