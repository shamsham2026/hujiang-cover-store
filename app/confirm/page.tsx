import { Suspense } from "react"
import { ConfirmView } from "@/components/confirm-view"

export default function Page() {
  return (
    <Suspense fallback={<p className="text-base text-muted-foreground">正在開啟安排…</p>}>
      <ConfirmView />
    </Suspense>
  )
}
