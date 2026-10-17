import { WEEKDAYS } from "@/lib/periods"

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function dayChar(iso: string): string {
  return WEEKDAYS[parseISO(iso).getDay()]
}

export function formatLongDate(iso: string): string {
  const d = parseISO(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dayChar(iso)}）`
}

/** Advance from a local calendar day until Mon–Fri (for 調課 / school-day flows). */
export function nextSchoolDay(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1)
  }
  return toISO(d)
}

function hongKongParts(now: Date = new Date()): { iso: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ""
  return {
    iso: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
  }
}

/**
 * 「今日」= Asia/Hong_Kong 本地曆日 YYYY-MM-DD。
 * 唔再因六／日跳去下個星期一（舊行為會令六顯示成一＋該日假期）。
 */
export function defaultSchoolDate(now: Date = new Date()): string {
  return hongKongParts(now).iso
}

export function schoolWeek(iso: string): string[] {
  const d = parseISO(iso)
  const monday = new Date(d)
  const offset = (d.getDay() + 6) % 7
  monday.setDate(d.getDate() - offset)
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return toISO(day)
  })
}

function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

