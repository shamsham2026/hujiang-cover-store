import { Suspense } from "react"
import { ArrangeView } from "@/components/arrange-view"

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">正在讀取教師時間表…</p>}>
      <ArrangeView />
    </Suspense>
  )
}
