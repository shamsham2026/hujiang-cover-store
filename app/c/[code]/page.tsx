import { Suspense } from "react"
import { ConfirmView } from "@/components/confirm-view"

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return (
    <Suspense fallback={<p className="text-base text-muted-foreground">正在開啟安排…</p>}>
      <ConfirmView code={code} />
    </Suspense>
  )
}
