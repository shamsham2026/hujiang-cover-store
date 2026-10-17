import { Suspense } from "react"
import { TimetableView } from "@/components/timetable-view"

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">正在讀取課表…</p>}>
      <TimetableView />
    </Suspense>
  )
}
