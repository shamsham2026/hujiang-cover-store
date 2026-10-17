import { Suspense } from "react"
import { LookupView } from "@/components/lookup-view"

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">正在讀取課表…</p>}>
      <LookupView />
    </Suspense>
  )
}
