export type PdfPage = { width: number; height: number }

/** 調課紙用 A4 直向，方便喺電話同列印機開。 */
export function formPdfPage(): PdfPage {
  return { width: 595, height: 842 }
}

/** 通知卡 PDF：跟卡紙比例，唔用 A4 長紙。width/height 為 canvas 像素。 */
export function noticePdfPage(imageWidth: number, imageHeight: number): PdfPage {
  const maxW = 320 // ~113mm，手機預覽舒服
  const width = Math.min(maxW, Math.max(240, Math.round(imageWidth / 4)))
  const height = Math.max(200, Math.round((width * imageHeight) / imageWidth))
  return { width, height }
}


function fmt(value: number) {
  return value.toFixed(2)
}

export type PdfLink = {
  url: string
  /** Pixel rect on the JPEG/canvas (top-left origin, same units as width/height). */
  x: number
  y: number
  w: number
  h: number
}

export type PdfJpegPage = {
  jpeg: Uint8Array
  width: number
  height: number
  links?: PdfLink[]
}

function escapePdfString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

function imagePlacement(imageWidth: number, imageHeight: number, page: PdfPage) {
  // 通知卡頁面本身已按比例；用細邊距貼滿。A4 長紙仍用較寬邊距。
  const compact = page.width <= 400 || page.height <= 500
  const margin = compact ? 10 : 28
  const maxW = page.width - margin * 2
  const maxH = page.height - margin * 2
  const fit = Math.min(maxW / imageWidth, maxH / imageHeight)
  const drawW = imageWidth * fit
  const drawH = imageHeight * fit
  const x = (page.width - drawW) / 2
  const y = compact ? (page.height - drawH) / 2 : page.height - margin - drawH
  return { fit, drawW, drawH, x, y }
}

/** Map image-pixel rect (top-left) → PDF user-space [x1 y1 x2 y2] (bottom-left). */
export function linkRectToPdf(
  link: { x: number; y: number; w: number; h: number },
  imageWidth: number,
  imageHeight: number,
  page: PdfPage,
) {
  const { fit, x: ox, y: oy } = imagePlacement(imageWidth, imageHeight, page)
  const x1 = ox + link.x * fit
  const x2 = ox + (link.x + link.w) * fit
  const y2 = oy + (imageHeight - link.y) * fit
  const y1 = oy + (imageHeight - (link.y + link.h)) * fit
  return { x1, y1, x2, y2 }
}

/**
 * 把多頁 JPEG 存成一個 A4 PDF，並可為每頁加上 URI Link annotation。
 */
export function pdfFromJpegs(pages: PdfJpegPage[], page: PdfPage = formPdfPage()) {
  if (!pages.length) throw new Error("沒有可寫入的 PDF 頁")
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0
  function push(data: string | Uint8Array) {
    const bytes = typeof data === "string" ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }

  // Pre-assign object ids: 1 Catalog, 2 Pages, then per page: Page, Contents, Image, Links...
  type PagePlan = {
    pageId: number
    contentsId: number
    imageId: number
    linkIds: number[]
    links: PdfLink[]
    jpeg: Uint8Array
    width: number
    height: number
  }

  let nextId = 3
  const plans: PagePlan[] = pages.map((item) => {
    const pageId = nextId++
    const contentsId = nextId++
    const imageId = nextId++
    const links = (item.links || []).filter((link) => link.url && link.w > 0 && link.h > 0)
    const linkIds = links.map(() => nextId++)
    return {
      pageId,
      contentsId,
      imageId,
      linkIds,
      links,
      jpeg: item.jpeg,
      width: item.width,
      height: item.height,
    }
  })
  const totalObjects = nextId - 1
  const offsets = Array.from({ length: totalObjects + 1 }, () => 0)

  push("%PDF-1.4\n")
  offsets[1] = length
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
  offsets[2] = length
  const kids = plans.map((plan) => `${plan.pageId} 0 R`).join(" ")
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${plans.length} >>\nendobj\n`)

  for (const plan of plans) {
    const place = imagePlacement(plan.width, plan.height, page)
    const content = `q\n${fmt(place.drawW)} 0 0 ${fmt(place.drawH)} ${fmt(place.x)} ${fmt(place.y)} cm\n/Im0 Do\nQ\n`
    const annots =
      plan.linkIds.length > 0 ? ` /Annots [${plan.linkIds.map((id) => `${id} 0 R`).join(" ")}]` : ""

    offsets[plan.pageId] = length
    push(
      `${plan.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${plan.contentsId} 0 R /Resources << /XObject << /Im0 ${plan.imageId} 0 R >> >>${annots} >>\nendobj\n`,
    )

    offsets[plan.contentsId] = length
    push(`${plan.contentsId} 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`)

    offsets[plan.imageId] = length
    push(
      `${plan.imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${plan.width} /Height ${plan.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${plan.jpeg.length} >>\nstream\n`,
    )
    push(plan.jpeg)
    push("\nendstream\nendobj\n")

    plan.links.forEach((link, index) => {
      const id = plan.linkIds[index]
      const rect = linkRectToPdf(link, plan.width, plan.height, page)
      const uri = escapePdfString(link.url)
      offsets[id] = length
      push(
        `${id} 0 obj\n<< /Type /Annot /Subtype /Link /Rect [${fmt(rect.x1)} ${fmt(rect.y1)} ${fmt(rect.x2)} ${fmt(rect.y2)}] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>\nendobj\n`,
      )
    })
  }

  const startxref = length
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= totalObjects; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`)

  const out = new Uint8Array(length)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}

/** @deprecated single-page helper kept for call sites that still import it */
export function pdfFromJpeg(jpeg: Uint8Array, imageWidth: number, imageHeight: number, page: PdfPage) {
  return pdfFromJpegs([{ jpeg, width: imageWidth, height: imageHeight }], page)
}
