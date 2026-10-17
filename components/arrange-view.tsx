"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { TaskPlanner } from "@/components/task-planner"
import { Timeline } from "@/components/timeline"
import { TeacherPicker } from "@/components/teacher-picker"
import { buildNotice, copyText, downloadDataUrl, downloadNoticePdf, downloadPlanCard, shareNoticePdf, sharePlanCard } from "@/components/share-card"
import { useBoard } from "@/components/board-context"
import { arrangementPlans } from "@/lib/card"
import { defaultConfirmer, formatConfirmWhen, type InboxItem } from "@/lib/confirmations"
import { isDuty } from "@/lib/duty"
import { canonicalDutyPost, cycleShowsRemark } from "@/lib/duty-posts"
import { externalExchange, externalSwapError, externalSwapPlan } from "@/lib/external"
import { markSlots, planObservationError, remarkPlanError } from "@/lib/movement"
import { MovementRecord } from "@/components/movement-record"
import { gasCallsForPlan, type GasCall } from "@/lib/gas-payload"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { displayPlans } from "@/lib/arrangement-list"
import { planIdsClearedByConfirmations, removeNoticeGroup, removePlansByIds } from "@/lib/plan-clear"
import { REASONS, periodLabel, reasonReady, resolvedReason } from "@/lib/periods"
import { readGasUrl, readHiddenKeys, writeHiddenKeys } from "@/lib/plans"
import { useSharedPlans } from "@/components/use-shared-plans"
import { formatLongDate, legsOf, nextSchoolDay, plansToSwaps, revertPreview, teacherActivityHint, teacherName, teacherSlots, withHidden } from "@/lib/schedule"
import { coverCandidates, suggestForSlot } from "@/lib/suggest"
import type { SwapCycle } from "@/lib/cycles"
import type { Plan, ResolvedSlot } from "@/lib/types"

function sameArrangeClass(item: ResolvedSlot, requestedClass: string) {
  if (!requestedClass) return true
  const names = [item.className, item.location || "", ...item.className.split("、")]
  if (names.includes(requestedClass)) return true
  const wanted = canonicalDutyPost(requestedClass)
  return Boolean(wanted) && names.some((name) => canonicalDutyPost(name) === wanted)
}

export function ArrangeView() {
  const params = useSearchParams()
  const board = useBoard()
  const [date, setDate] = useState(params.get("date") || nextSchoolDay())
  const [teacher, setTeacher] = useState(params.get("teacher") || "淑")
  const { plans, replacePlans } = useSharedPlans()
  const listed = useMemo(() => displayPlans(plans), [plans])
  const listPlans = listed.plans
  const [slot, setSlot] = useState<ResolvedSlot | null>(null)
  const [mode, setMode] = useState<"cover" | "swap">(params.get("mode") === "swap" ? "swap" : "cover")
  const [partner, setPartner] = useState("")
  const [cycleId, setCycleId] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [reason, setReason] = useState("病假")
  const [reasonDetail, setReasonDetail] = useState("")
  const [partnerKey, setPartnerKey] = useState("")
  const [gasUrl, setGasUrl] = useState("")
  const [hidden, setHidden] = useState<string[]>([])
  const [status, setStatus] = useState("")
  const [sending, setSending] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [notice, setNotice] = useState<{
    url: string
    code: string
    image: string
    filename: string
    text: string
    error: string
    who: string
    confirming: boolean
    confirmed: InboxItem | null
    plan: Plan | null
    related: Plan[]
  } | null>(null)
  const opened = useRef(false)

  useEffect(() => {
    setGasUrl(readGasUrl())
    setHidden(readHiddenKeys())
  }, [])

  // 定時／focus 拉確認紀錄：凡已確認嘅 arrangement（主＋related）一齊移出本次安排
  useEffect(() => {
    let cancelled = false
    async function purgeConfirmed() {
      if (!plans.length) return
      try {
        const response = await fetch("/api/confirmations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
        const body = await response.json().catch(() => null)
        if (cancelled || !response.ok || !Array.isArray(body?.items)) return
        const ids = planIdsClearedByConfirmations(plans, body.items)
        if (!ids.size) return
        const next = removePlansByIds(plans, ids)
        if (next.length === plans.length) return
        await replacePlans(next)
        setStatus("已確認的安排已移出本次安排。")
      } catch {
        // ignore
      }
    }
    void purgeConfirmed()
    const timer = window.setInterval(() => void purgeConfirmed(), 15000)
    const onFocus = () => void purgeConfirmed()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [plans, replacePlans])

  const extra = useMemo(() => plansToSwaps(plans), [plans])
  const data = board.data ? withHidden(board.data, hidden) : null
  const rawDay = data ? teacherSlots(data, date, teacher, extra) : null
  const day = data && rawDay ? { current: markSlots(data, date, rawDay.current), away: markSlots(data, date, rawDay.away) } : null

  useEffect(() => {
    if (opened.current || !data || !day) return
    const period = params.get("period")
    const who = params.get("teacher")
    const requestedClass = params.get("class") || ""
    if (!period || !who) return
    const hits = day.current.filter((item) => item.period === period && (item.baseTeachers.includes(who) || item.teachers.includes(who) || item.location === requestedClass))
    const match = hits.find((item) => sameArrangeClass(item, requestedClass)) || hits[0]
    if (!match) return
    openSlot(match, params.get("mode") === "swap" ? "swap" : "cover")
    opened.current = true
  }, [data, day, params])

  const covers = useMemo(() => {
    if (!data || !slot) return null
    const className = slot.duty ? "" : slot.className.split("、")[0]
    return coverCandidates({
      data,
      date,
      period: slot.period,
      className,
      exclude: slot.baseTeachers.length ? slot.baseTeachers : slot.teachers,
      swaps: extra,
    })
  }, [data, slot, date, extra])

  const suggestion = useMemo(() => {
    if (!data || !slot?.unitId || slot.empty) return null
    return suggestForSlot({ data, date, unitId: slot.unitId, targetDate: mode === "swap" ? targetDate : undefined, swaps: extra })
  }, [data, slot, date, targetDate, mode, extra])

  const selectedCycle = suggestion?.search.cycles.find((cycle) => cycle.id === cycleId) || null
  const slotClass = slot ? (slot.duty ? slot.location || slot.className : slot.className.split("、")[0] || slot.className) : ""
  const exchange = useMemo(() => {
    if (!data || !slot || slot.duty || !slotClass) return null
    return externalExchange(data, date, slotClass, slot.period, extra, targetDate)
  }, [data, slot, slotClass, date, extra, targetDate])
  const selectedPartner = exchange?.partners.find((item) => `${item.className}|${item.period}` === partnerKey) || null
  const externalDraft = slot && exchange?.programme && selectedPartner
    ? externalSwapPlan(date, {
        className: slotClass,
        period: slot.period,
        programme: exchange.programme,
        course: slot.course,
        teachers: slot.teachers.length ? slot.teachers : slot.baseTeachers,
      }, selectedPartner, targetDate || date)
    : null
  const draft = externalDraft || (slot ? buildDraft({ slot, mode, date, targetDate, partner, reason: resolvedReason(reason, reasonDetail), cycle: selectedCycle }) : null)
  const coverReady = reasonReady(reason, reasonDetail) && Boolean(draft?.partnerTeacher)
  const swapReady = Boolean(draft?.mode === "swap" && draft.legs && draft.legs.length > 1)
  const held = Boolean(slot?.fixed)
  const canConfirm = held ? false : exchange?.programme ? Boolean(selectedPartner) : draft?.mode === "cover" ? coverReady : swapReady
  const clearing = board.data && plans.length ? revertPreview(board.data, plans, hidden) : null

  function openSlot(item: ResolvedSlot, nextMode: "cover" | "swap" = "cover") {
    setSlot(item)
    setPartner("")
    setPartnerKey("")
    setCycleId("")
    setMode(nextMode)
    // 預設當天對調（非當值）；要跨日先再改日期。當值仍要先揀調往日。
    setTargetDate(nextMode === "swap" && !item.duty ? date : "")
    setReason("病假")
    setReasonDetail("")
  }

  async function savePlans(next: Plan[]) {
    await replacePlans(next)
  }

  function rememberHidden(next: string[]) {
    setHidden(next)
    writeHiddenKeys(next)
  }

  async function postCalls(calls: GasCall[]) {
    const seen = new Set<string>()
    const errors: string[] = []
    let wrote = 0
    for (const call of calls) {
      const fingerprint = JSON.stringify(call.payload)
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      const response = await fetch("/api/gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gasUrl, payload: call.payload }),
      })
      const body = await response.json().catch(() => ({ success: false, message: "試算表沒有回傳可讀的結果。" }))
      if (!response.ok || body.success === false) errors.push(body.message || body.error || "試算表沒有寫入")
      else wrote += 1
    }
    return { wrote, errors }
  }

  async function adoptBundle(bundle: { cycles: SwapCycle[]; covers: { date: string; period: string; className: string; course: string; teacher: string; teachers: string[]; coverTeacher: string; reason: string }[]; reason: string }) {
    if (!data || (bundle.cycles.length === 0 && bundle.covers.length === 0)) return
    const { cycles, covers, reason } = bundle
    const saved: Plan[] = cycles.map((cycle, index): Plan => {
      const first = cycle.legs[0]
      const second = cycle.legs[1]
      return {
        id: `${Date.now()}-${index}`,
        mode: "swap",
        date: first.date,
        targetDate: first.toDate,
        period: first.period,
        className: first.className,
        course: first.course,
        teacher: first.teacher,
        teachers: first.teachers,
        partnerTeacher: second?.teacher || "",
        partnerTeachers: second?.teachers,
        partnerPeriod: second?.period || "",
        partnerCourse: second?.course || "",
        reason,
        tier: cycle.tier,
        duty: isDuty(first.period, first.course) || isDuty(second?.period || "", second?.course || ""),
        legs: cycle.legs,
      }
    }).concat(covers.map((cover, index) => ({
      id: `${Date.now()}-c${index}`,
      mode: "cover" as const,
      date: cover.date,
      targetDate: cover.date,
      period: cover.period,
      className: cover.className,
      course: cover.course,
      teacher: cover.teacher,
      teachers: cover.teachers,
      partnerTeacher: cover.coverTeacher,
      partnerTeachers: [cover.coverTeacher],
      partnerPeriod: cover.period,
      partnerCourse: cover.course,
      reason: cover.reason || reason || "代課",
      tier: "代課",
      duty: isDuty(cover.period, cover.course),
      legs: [
        {
          date: cover.date,
          period: cover.period,
          toDate: cover.date,
          toPeriod: cover.period,
          className: cover.className,
          course: cover.course,
          teacher: cover.coverTeacher,
          teachers: [cover.coverTeacher],
        },
      ],
    })))
    const refused = saved.map((plan) => externalSwapError(data, plan) || planObservationError(data, plan) || remarkPlanError(plan)).find(Boolean)
    if (refused) {
      setStatus(refused)
      return
    }
    const next = [...saved, ...plans]
    const label = saved.map((plan) => plan.tier || (plan.mode === "cover" ? "代課" : "調課")).join("、")
    try {
      await savePlans(next)
    } catch {
      setStatus("安排未能儲存，請再試一次。")
      return
    }
    setStatus(`已加入本次安排（${label}）。`)
    if (typeof document !== "undefined") {
      window.requestAnimationFrame(() => {
        document.querySelector("[data-testid=current-plans]")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      })
    }
    if (!gasUrl.trim()) return
    setSending(true)
    try {
      const calls = saved.flatMap((plan) => gasCallsForPlan(plan, next))
      await postCalls(calls)
      board.refresh()
    } catch {
      setStatus(`已加入本次安排（${label}）。`)
    } finally {
      setSending(false)
    }
  }

async function addPlan() {
    if (!draft || !data || !canConfirm) return
    if (draft.mode === "cover" && !reasonReady(reason, reasonDetail)) return
    const saved = { ...draft, id: `${Date.now()}`, reason: draft.mode === "cover" ? resolvedReason(reason, reasonDetail) : draft.reason }
    const refused = externalSwapError(data, saved) || planObservationError(data, saved) || remarkPlanError(saved)
    if (refused) {
      setStatus(refused)
      return
    }
    const next = [saved, ...plans]
    try {
      await savePlans(next)
    } catch {
      setStatus("安排未能儲存，請再試一次。")
      return
    }
    rememberHidden(hidden.filter((key) => !plansToSwaps([saved]).some((row) => row.key === key)))
    setSlot(null)
    setStatus("課表已更新。")
    if (!gasUrl.trim()) return
    setSending(true)
    try {
      await postCalls(gasCallsForPlan(saved, next))
      board.refresh()
    } catch {
      setStatus("課表已更新。")
    } finally {
      setSending(false)
    }
  }

  function blankNotice(who = ""): NonNullable<typeof notice> {
    return { url: "", code: "", image: "", filename: "", text: "", error: "", who, confirming: false, confirmed: null, plan: null, related: [] }
  }


  async function confirmUrlFor(plan: Plan) {
    try {
      const response = await fetch("/api/confirm-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, related: arrangementPlans(plan, plans), gasUrl }),
      })
      const body = await response.json().catch(() => null)
      if (body?.ok && typeof body.url === "string" && body.url) return body.url as string
      if (typeof body?.url === "string" && body.url) return body.url as string
    } catch {
      // ignore
    }
    return undefined
  }

  async function downloadNoticeCardImage(plan: Plan) {
    if (!board.data) return
    await downloadPlanCard(plan, board.data, arrangementPlans(plan, plans))
    setStatus("通知卡圖片已下載。")
  }

  async function shareNoticeCardImage(plan: Plan) {
    if (!board.data) return
    const result = await sharePlanCard(plan, board.data, arrangementPlans(plan, plans))
    if (result === "shared") setStatus("已分享通知卡。")
    else if (result === "downloaded") setStatus("已下載通知卡，可在檔案中傳去 WhatsApp。")
  }

  async function downloadNoticeCardPdf(plan: Plan) {
    const related = arrangementPlans(plan, plans)
    const confirmUrl = await confirmUrlFor(plan)
    await downloadNoticePdf(plan, related, confirmUrl)
    setStatus("通知卡 PDF 已下載（綠掣可撳確認）。")
  }

  async function shareNoticeCardPdf(plan: Plan) {
    const related = arrangementPlans(plan, plans)
    const confirmUrl = await confirmUrlFor(plan)
    const result = await shareNoticePdf(plan, related, confirmUrl)
    if (result === "shared") setStatus("已下載「日-月-年-調課／代課安排.pdf」並開啟分享。若 WhatsApp 檔名亂碼，請改用檔案附件傳送剛下載嗰份。")
    else if (result === "downloaded") setStatus("已下載通知卡 PDF（中文檔名），請用檔案傳去 WhatsApp。")
  }

  async function openNotice(plan: Plan) {
    const who = plan.teacher || defaultConfirmer(plan, arrangementPlans(plan, plans))
    setNotice(blankNotice(who))
    try {
      const response = await fetch("/api/confirm-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, related: arrangementPlans(plan, plans), gasUrl }),
      })
      const body = await response.json()
      if (!response.ok || !body.url || !body.code) {
        setNotice({ ...blankNotice(who), error: body.message || "未能產生確定連結。" })
        return
      }
      let image = ""
      let filename = "調課安排.png"
      let text = body.url as string
      try {
        const pack = await buildNotice(plan, arrangementPlans(plan, plans))
        image = pack.dataUrl
        filename = pack.filename
        text = pack.card.footer || pack.card.title
      } catch {
        text = body.url
      }
      const code = body.code as string
      setNotice({ url: body.url, code, image, filename, text, error: "", who, confirming: false, confirmed: null, plan, related: arrangementPlans(plan, plans) })
      const statusResponse = await fetch(`/api/confirm?c=${encodeURIComponent(code)}`)
      const statusBody = await statusResponse.json().catch(() => null)
      if (statusBody?.confirmed && statusBody.item) {
        setNotice((prev) => (prev && prev.code === code ? { ...prev, confirmed: statusBody.item } : prev))
        // 同事已用連結確定 → 同樣清出本次安排
        savePlans(removeNoticeGroup(plans, plan, arrangementPlans(plan, plans)))
        setStatus("已確定。已移出本次安排。")
      }
    } catch {
      setNotice({ ...blankNotice(who), error: "未能產生確定連結。請再按一次。" })
    }
  }

  async function confirmFromDialog() {
    const current = notice
    if (!current?.code || current.confirming || current.confirmed || !current.who.trim()) return
    setNotice({ ...current, confirming: true, error: "" })
    try {
      const response = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: current.code, who: current.who.trim() }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok || !body.item) {
        setNotice((prev) => (prev ? { ...prev, confirming: false, error: body.message || "未能確定。" } : prev))
        return
      }
      setNotice((prev) => (prev ? { ...prev, confirming: false, confirmed: body.item, error: "" } : prev))
      setStatus(body.message || "已確定。已移出本次安排。")
      // 確認完成 → 真正清出本次安排（主＋related）；下載紙／離開頁唔會清
      savePlans(removeNoticeGroup(plans, current.plan, current.related))
      board.refresh()
    } catch {
      setNotice((prev) => (prev ? { ...prev, confirming: false, error: "未能確定。請再按一次。" } : prev))
    }
  }

  async function clearPlans() {
    if (!clearing) return
    const keys = clearing.rows.map((row) => row.key)
    savePlans([])
    rememberHidden([...hidden, ...keys])
    setClearOpen(false)
    setStatus("這次安排已清走，課表已回到先前的老師。")
    if (!gasUrl.trim()) return
    setSending(true)
    try {
      await fetch("/api/gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gasUrl, payload: { action: "deleteTempEntries", keys } }),
      })
      board.refresh()
    } catch {
      setStatus("這次安排已清走，課表已回到先前的老師。")
    } finally {
      setSending(false)
    }
  }

  if (!data || !day) return <p className="text-sm text-muted-foreground">正在讀取教師時間表…</p>

  const grouped = groupCycles((suggestion?.search.cycles || []).filter((cycle) => !cycleShowsRemark(cycle.legs)))
  const hint = data ? teacherActivityHint(data, date, teacher, extra) : ""

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-3xl">安排調課或代課</h1>
        <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-end">
          <label className="text-base">
            <span className="mb-1 block text-sm text-muted-foreground">日期</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 w-full rounded-lg border bg-card px-3 text-base" />
          </label>
          <TeacherPicker teachers={data.teachers} value={teacher} onChange={setTeacher} />
        </div>
        {hint ? <p data-testid="activity-hint" className="mt-3 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <TaskPlanner data={data} swaps={extra} teachers={data.teachers} teacher={teacher} onAdopt={(bundle) => void adoptBundle(bundle)} />
      <p className="text-sm">{teacherName(data, teacher)} · {formatLongDate(date)}</p>
      <MovementRecord data={data} date={date} extra={extra} />
      <Timeline slots={day.current} onPick={openSlot} />
      {day.away.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm text-muted-foreground">這天已調走的原課堂</h2>
          <Timeline slots={day.away} />
        </div>
      ) : null}

      <section className="rounded-2xl border bg-card p-4" data-testid="current-plans">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-xl">本次安排</h2>
          <span className="text-sm text-muted-foreground">{listPlans.length} 筆{listed.hiddenDuplicateCount ? `（已隱藏重複 ${listed.hiddenDuplicateCount}）` : ""}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="plans-clear-hint">確認完成或手動清除後會消失；下載紙／離開頁唔會清。歷史喺「紀錄」。</p>
        {listPlans.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">還沒有加入安排。點上面的課堂即可開始。</p>
        ) : (
          <ul className="mt-3 divide-y" data-testid="plans-by-movement-date">
            {listPlans.map((plan) => (
              <li key={plan.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{plan.mode === "cover" ? "代課" : plan.tier || "調課"}</Badge>
                    <span>{plan.date}{plan.mode === "swap" && plan.targetDate && plan.targetDate !== plan.date ? ` → ${plan.targetDate}` : ""} {plan.className} {periodLabel(plan.period)}{plan.reason ? `（${plan.reason}）` : ""}</span>
                  </div>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {legsOf(plan).map((leg, index) => (
                      <li key={`${plan.id}-${index}`}>
                        {(leg.teachers || [leg.teacher]).join("、")} {leg.course}：{leg.date === leg.toDate ? `${periodLabel(leg.period)} → ${periodLabel(leg.toPeriod)}` : `${leg.date} ${periodLabel(leg.period)} → ${leg.toDate} ${periodLabel(leg.toPeriod)}`}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="min-h-11" onClick={() => void downloadNoticeCardImage(plan)}>下載圖片</Button>
                  <Button variant="outline" className="min-h-11" onClick={() => void shareNoticeCardPdf(plan)}>分享圖片</Button>
                  <Button variant="outline" className="min-h-11" data-testid="download-pdf" onClick={() => void downloadNoticeCardPdf(plan)}>下載 PDF</Button>
                  <Button variant="outline" className="min-h-11" data-testid="confirm-link" onClick={() => void openNotice(plan)}>通知／確認</Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => savePlans(plans.filter((item) => item.id !== plan.id))}>
                    移除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/slip" />} disabled={plans.length === 0}>列印調課紙</Button>
          <Button variant="outline" data-testid="clear-plans" disabled={plans.length === 0 || sending} onClick={() => setClearOpen(true)}>清走這次安排</Button>
        </div>
        {status ? <p data-testid="arrange-status" className="mt-3 text-sm">{status}</p> : null}
      </section>

      <Dialog open={notice != null} onOpenChange={(open) => !open && setNotice(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>通知同事</DialogTitle>
            <DialogDescription>請分享／下載下面嘅通知卡（含綠掣「確認以上安排」）。唔好只傳網站連結，避免 WhatsApp 出綠 URL 預覽。</DialogDescription>
          </DialogHeader>
          {notice && !notice.url && !notice.error ? <p className="text-sm text-muted-foreground">正在準備通知…</p> : null}
          {notice?.error ? <p className="text-sm">{notice.error}</p> : null}
          {notice?.url ? (
            <div className="space-y-3">
              {notice.image ? (
                <img data-testid="notify-image" src={notice.image} alt="調課通知" className="w-full rounded-lg border" />
              ) : (
                <p className="text-sm text-muted-foreground">通知圖暫時未能畫出，請用「下載 PDF」。</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  data-testid="whatsapp-notify"
                  disabled={!notice.plan}
                  onClick={() => {
                    if (!notice.plan) return
                    void shareNoticePdf(notice.plan, notice.related, notice.url).then((result) => {
                      if (result === "shared") setStatus("已下載正確中文檔名並開啟分享（綠掣可撳）。若 WhatsApp 顯示亂碼，請改用檔案附件傳送剛下載嘅 PDF。")
                      else if (result === "downloaded") setStatus("已下載通知細 PDF（中文檔名），請用檔案傳去 WhatsApp。")
                    })
                  }}
                >
                  分享通知卡
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  data-testid="download-notice-pdf"
                  disabled={!notice.plan}
                  onClick={() => {
                    if (!notice.plan) return
                    void downloadNoticePdf(notice.plan, notice.related, notice.url).then(() => {
                      setStatus("通知細 PDF 已下載（綠掣可撳確認）。")
                    })
                  }}
                >
                  下載 PDF
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  data-testid="download-notice"
                  disabled={!notice.image}
                  onClick={() => {
                    if (!notice.image) return
                    downloadDataUrl(notice.image, notice.filename)
                    setStatus("通知卡圖片已下載。")
                  }}
                >
                  下載圖片
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  data-testid="copy-confirm-link"
                  onClick={() => {
                    void copyText(notice.url).then((copied) => setStatus(copied ? "已複製確定連結（備用）。請優先傳通知卡檔。" : notice.url))
                  }}
                >
                  複製連結（備用）
                </Button>
              </div>
              <input
                data-testid="notify-link"
                readOnly
                value={notice.url}
                onFocus={(event) => event.currentTarget.select()}
                className="h-11 w-full rounded-lg border bg-card px-3 text-xs text-muted-foreground"
              />
              <div className="space-y-2 border-t pt-3">
                {notice.confirmed ? (
                  <p data-testid="notice-confirmed" className="text-base">
                    已確定　{notice.confirmed.who}　{formatConfirmWhen(notice.confirmed.when)}
                  </p>
                ) : (
                  <>
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">確認人</span>
                      <input
                        data-testid="notice-who"
                        value={notice.who}
                        onChange={(event) => setNotice((prev) => (prev ? { ...prev, who: event.target.value } : prev))}
                        className="h-11 w-full rounded-lg border bg-card px-3 text-base"
                      />
                    </label>
                    <Button
                      className="min-h-11 w-full"
                      data-testid="notice-confirm"
                      disabled={notice.confirming || !notice.who.trim()}
                      onClick={() => void confirmFromDialog()}
                    >
                      {notice.confirming ? "確認中…" : "確認"}
                    </Button>
                  </>
                )}
                <p className="text-sm text-muted-foreground">問完同事後按確認。同事仍可用上面的短連結自己確定。</p>
              </div>
              <p className="text-sm text-muted-foreground">請撳「分享通知卡」：會先下載正確中文檔名（例 29-09-2026-調課安排.pdf），再開啟系統分享。WhatsApp 若仍亂碼，請用檔案附件傳送剛下載嗰份（綠掣可撳）。</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>清走這次安排</DialogTitle>
            <DialogDescription>只清走下面列出的這次安排，不會動其他日子或其他老師的紀錄。</DialogDescription>
          </DialogHeader>
          {clearing ? (
            <div data-testid="clear-preview" className="space-y-3 text-sm">
              <div>
                <h3 className="font-medium">畫面上的最新課表</h3>
                <ul className="mt-1 space-y-1">
                  {clearing.cells.map((cell) => (
                    <li key={`${cell.date}-${cell.className}-${cell.period}`}>
                      {cell.date} {cell.className} {periodLabel(cell.period)}：{cell.teacher} {cell.course} 會回到 {cell.baseTeacher} {cell.baseCourse}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">會清走的調動</h3>
                <ul className="mt-1 space-y-1">
                  {clearing.rows.map((row) => (
                    <li key={row.key}>{row.key}　{row.origTeacher} → {row.newTeacher}　{row.newLesson}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">WhatsApp 確認圖與調課紙</h3>
                <ul className="mt-1 space-y-1">
                  {plans.map((plan) => (
                    <li key={plan.id}>{plan.date} {plan.className} {periodLabel(plan.period)} {plan.reason ? `（${plan.reason}）` : ""}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setClearOpen(false)}>返回</Button>
            <Button data-testid="confirm-clear" disabled={sending} onClick={() => void clearPlans()}>確認清走</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={slot != null} onOpenChange={(open) => !open && setSlot(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {slot ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {slot.className || "當值"} · {periodLabel(slot.period)}
                </DialogTitle>
                <DialogDescription>
                  {slot.empty ? "未編更" : slot.baseCourse || slot.course}
                  {slot.baseTeachers.length ? ` · ${slot.baseTeachers.join("、")}` : ""}
                </DialogDescription>
              </DialogHeader>
              {slot.coTeach ? <Badge data-testid="coteach">合教 {slot.baseTeachers.join("、")}</Badge> : null}
              {slot.fixed ? null : exchange?.programme ? (
                <div className="space-y-3">
                  <div className="sm:max-w-xs">
                    <MakeupDate duty={false} value={targetDate} onChange={(value) => { setTargetDate(value); setPartnerKey("") }} />
                  </div>
                  <p data-testid="external-badge">校外導師 {exchange.programme}</p>
                  <div className="max-h-72 space-y-1 overflow-auto">
                    {exchange.partners.map((item) => (
                      <button
                        key={`${item.className}-${item.period}`}
                        type="button"
                        data-testid="external-partner"
                        onClick={() => setPartnerKey(`${item.className}|${item.period}`)}
                        className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${partnerKey === `${item.className}|${item.period}` ? "border-primary bg-accent" : "bg-card"}`}
                      >
                        {item.summary}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button data-testid="mode-cover" data-active={mode === "cover" ? "1" : "0"} variant={mode === "cover" ? "default" : "outline"} className="min-h-12 px-5 text-base" onClick={() => { setMode("cover"); setCycleId("") }}>代課</Button>
                    <Button data-testid="mode-swap" data-active={mode === "swap" ? "1" : "0"} variant={mode === "swap" ? "default" : "outline"} className="min-h-12 px-5 text-base" onClick={() => { setMode("swap"); if (!slot.duty) setTargetDate((current) => current || date) }}>
                      {slot.duty ? "改日對調" : "對調"}
                    </Button>
                  </div>
                  {mode === "cover" ? (
                    <div className="space-y-3">
                      <Select value={reason} onValueChange={(value) => setReason(value || "病假")}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REASONS.map((item) => (
                            <SelectItem key={item} value={item}>{item}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {reason === "其他" ? (
                        <Input
                          data-testid="reason-detail"
                          value={reasonDetail}
                          placeholder="請填寫原因"
                          onChange={(event) => setReasonDetail(event.target.value)}
                        />
                      ) : null}
                      <div className="max-h-64 space-y-1 overflow-auto">
                        {covers && covers.eligible.length === 0 ? <p className="text-sm text-muted-foreground">這一節沒有符合資格的空堂老師。</p> : null}
                        {covers?.eligible.map((row) => (
                          <button
                            key={row.teacher}
                            type="button"
                            data-testid="cover-candidate"
                            onClick={() => setPartner(row.teacher)}
                            className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${partner === row.teacher ? "border-primary bg-accent" : "bg-card"}`}
                          >
                            <span className="font-medium">{row.rank}. {row.teacher} {row.fullName}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1 sm:max-w-xs">
                          <MakeupDate duty={Boolean(slot.duty)} value={targetDate} onChange={(value) => { setTargetDate(value); setCycleId("") }} />
                        </div>
                        {!slot.duty ? (
                          <p className="pb-2 text-sm text-muted-foreground sm:flex-1">預設當天對調；要跨日先再改左手邊日期。</p>
                        ) : null}
                      </div>
                      <div className="max-h-72 space-y-3 overflow-auto">
                        {grouped.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{slot.duty && !targetDate ? "先選擇調往日期。" : slot.duty ? "這一天沒有可對調的同節當值。" : targetDate ? "這一天沒有可採用的對調。" : "這一班沒有可採用的對調。"}</p>
                        ) : null}
                        {grouped.map((group) => (
                          <section key={group.tier}>
                            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{group.tier}</h3>
                            <div className="space-y-1">
                              {group.cycles.map((cycle) => (
                                <button
                                  key={cycle.id}
                                  type="button"
                                  data-testid="swap-cycle"
                                  data-tier={cycle.tier}
                                  data-target-date={cycle.legs[0]?.toDate || ""}
                                  onClick={() => setCycleId(cycle.id)}
                                  className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${cycleId === cycle.id ? "border-primary bg-accent" : "bg-card"}`}
                                >
                                  <Badge variant="outline">{cycle.tier}</Badge>
                                  <span className="mt-1 block">{cycle.summary}</span>
                                </button>
                              ))}
                            </div>
                          </section>
                        ))}
                        {slot.duty && suggestion?.search.blocked.length ? (
                          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {suggestion.search.blocked.map((item) => (
                              <p key={`${item.summary}-${item.reason}`}>{item.summary}：{item.reason}</p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </>
              )}

              {held ? null : draft?.mode === "swap" && draft.legs && draft.legs.length > 1 ? (
                <ul data-testid="leg-preview" className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  {draft.legs.map((leg, index) => (
                    <li key={`${leg.period}-${index}`}>
                      {index + 1}. {(leg.teachers || [leg.teacher]).join("、")} {leg.course}　{leg.date === leg.toDate ? "" : `${leg.date} `}{periodLabel(leg.period)} → {leg.toDate === leg.date ? "" : `${leg.toDate} `}{periodLabel(leg.toPeriod)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {held ? null : draft?.mode === "cover" && draft.partnerTeacher ? (
                <p data-testid="leg-preview" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  {draft.teacher} {draft.course} {periodLabel(draft.period)} → 由 {draft.partnerTeacher} 代課{resolvedReason(reason, reasonDetail) ? `（${resolvedReason(reason, reasonDetail)}）` : ""}
                </p>
              ) : null}
              {held ? null : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-12 px-4 text-base"
                  data-testid="download-card"
                  disabled={!canConfirm || !draft}
                  onClick={() => draft && void downloadNoticeCardImage(draft)}
                >
                  下載圖片
                </Button>
                <Button
                  variant="outline"
                  className="min-h-12 px-4 text-base"
                  disabled={!canConfirm || !draft}
                  onClick={() => draft && void shareNoticeCardPdf(draft)}
                >
                  分享圖片
                </Button>
                <Button
                  variant="outline"
                  className="min-h-12 px-4 text-base"
                  data-testid="download-pdf"
                  disabled={!canConfirm || !draft}
                  onClick={() => draft && void downloadNoticeCardPdf(draft)}
                >
                  下載 PDF
                </Button>
                <Button data-testid="confirm-plan" className="min-h-12 px-5 text-base" onClick={() => void addPlan()} disabled={sending || !canConfirm}>
                  加入安排
                </Button>
              </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MakeupDate({ duty, value, onChange }: { duty: boolean; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{duty ? "調往日期" : "對調／上回日期"}</span>
      <input
        type="date"
        data-testid="makeup-date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-lg border bg-background px-3 text-base"
      />
    </label>
  )
}

function groupCycles(cycles: SwapCycle[]) {
  const tiers = ["同日對調", "同日三方", "同日四方", "跨日對調", "跨日三方"] as const
  return tiers
    .map((tier) => ({ tier, cycles: cycles.filter((cycle) => cycle.tier === tier) }))
    .filter((group) => group.cycles.length > 0)
}

function buildDraft(args: {
  slot: ResolvedSlot
  mode: "cover" | "swap"
  date: string
  targetDate: string
  partner: string
  reason: string
  cycle: SwapCycle | null
}): Plan {
  const className = args.slot.duty ? args.slot.location || args.slot.className : args.slot.className.split("、")[0] || args.slot.className
  const course = args.slot.baseCourse || args.slot.course
  const teachers = args.slot.baseTeachers.length ? args.slot.baseTeachers : args.slot.teachers
  if (args.mode === "swap" && args.cycle) {
    const first = args.cycle.legs[0]
    const second = args.cycle.legs[1]
    return {
      id: "draft",
      mode: "swap",
      date: first.date,
      targetDate: first.toDate,
      period: first.period,
      className: first.className || className,
      course: first.course,
      teacher: first.teacher,
      teachers: first.teachers,
      partnerTeacher: second?.teacher || "",
      partnerTeachers: second?.teachers,
      partnerPeriod: second?.period || "",
      partnerCourse: second?.course || "",
      reason: "",
      tier: args.cycle.tier,
      duty: args.slot.duty,
      legs: args.cycle.legs,
    }
  }
  return {
    id: "draft",
    mode: "cover",
    date: args.date,
    targetDate: args.date,
    period: args.slot.period,
    className,
    course,
    teacher: teachers[0] || "未編",
    teachers,
    partnerTeacher: args.partner,
    partnerPeriod: args.slot.period,
    partnerCourse: course,
    reason: args.reason,
    tier: "代課",
    duty: Boolean(args.slot.duty),
    legs: [
      {
        date: args.date,
        period: args.slot.period,
        toDate: args.date,
        toPeriod: args.slot.period,
        className,
        course,
        teacher: args.partner,
        teachers: args.partner ? [args.partner] : [],
      },
    ],
  }
}
