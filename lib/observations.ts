/** 校長觀課時間表（2026年10月10日版）。只鎖寫明的那一節。 */

export type Observation = {
  date: string
  period: string
  className: string
  course: string
}

export const OBSERVATIONS: Observation[] = [
  { date: "2026-10-12", period: "5", className: "6A", course: "普通話（蔡）" },
  { date: "2026-10-13", period: "2", className: "4A", course: "中文（寧）" },
  { date: "2026-10-15", period: "2", className: "2B", course: "中文（舒）" },
  { date: "2026-11-05", period: "4", className: "4C", course: "中文（黃）" },
  { date: "2026-11-09", period: "6", className: "1A", course: "科學（泳）" },
  { date: "2026-11-10", period: "2", className: "2D", course: "中文（江）" },
  { date: "2026-11-12", period: "2", className: "1A", course: "中文（曉）" },
  { date: "2026-11-12", period: "6", className: "6C", course: "常識（俊），袁觀" },
  { date: "2026-11-16", period: "2", className: "6B", course: "電腦（嘉）" },
  { date: "2026-11-17", period: "6", className: "6B", course: "體育（珽）" },
  { date: "2026-11-17", period: "8", className: "5B", course: "數學（悠）" },
  { date: "2026-11-18", period: "5", className: "2C", course: "英文（錦）" },
  { date: "2026-11-18", period: "6", className: "2C", course: "英文（錦）" },
  { date: "2026-11-19", period: "2", className: "5D", course: "數學（儀）" },
  { date: "2026-11-20", period: "5", className: "2C", course: "音樂（忻）" },
  { date: "2026-11-25", period: "8", className: "1B", course: "體育（梓）" },
  { date: "2026-11-26", period: "6", className: "2B", course: "人文（森），羅觀" },
  { date: "2026-11-27", period: "4", className: "6B", course: "視藝（胡）" },
  { date: "2026-11-27", period: "5", className: "2B", course: "圖書（健）" },
  { date: "2026-11-27", period: "8", className: "3B", course: "電腦（燁），羅觀" },
  { date: "2026-11-30", period: "2", className: "5D", course: "英文（淑）" },
  { date: "2026-12-01", period: "2", className: "6A", course: "數學（吳）" },
  { date: "2026-12-02", period: "6", className: "1C", course: "英文（馬）" },
  { date: "2026-12-07", period: "2", className: "6C", course: "英文（莊）" },
  { date: "2027-01-20", period: "8", className: "6D", course: "音樂（樂）" },
  { date: "2027-01-26", period: "5", className: "5C", course: "視藝（裕）" },
  { date: "2027-01-26", period: "8", className: "6D", course: "常識（高）" },
  { date: "2027-01-27", period: "8", className: "3B", course: "普通話（燕）" },
]

export function observationOn(date: string, className: string, period: string) {
  const names = className.split(/[、,，]/).map((item) => item.trim())
  return OBSERVATIONS.find((item) => item.date === date && item.period === period && names.includes(item.className)) || null
}
