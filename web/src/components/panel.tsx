// The card and page-title patterns shared by the dashboard, Members and Settings (plan §13, design system v2).
import { cn } from "@/lib/utils"

export function Panel({ title, aside, children, className }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("glass flex min-w-0 flex-col rounded-[24px] p-5 sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 text-base font-semibold tracking-tight">{title}</h2>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

export function PageTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {detail && <p className="mt-1 text-muted-foreground">{detail}</p>}
    </div>
  )
}
