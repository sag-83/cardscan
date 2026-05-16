import * as React from "react"
import { ArrowRight, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { BorderBeam } from "@/components/ui/border-beam"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const HERO_IMG =
  "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80&auto=format&fit=crop"
const HERO_IMG_SECONDARY =
  "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&q=80&auto=format&fit=crop"

export type Hero195Props = {
  className?: string
  onPrimaryAction?: () => void
}

export function Hero195({ className, onPrimaryAction }: Hero195Props) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-background via-card to-muted/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950 dark:border-slate-800",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-1/4 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative grid gap-8 p-6 md:grid-cols-2 md:p-10 lg:gap-12">
        <div className="flex flex-col justify-center gap-6">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
            <Sparkles className="size-3.5 text-amber-500" aria-hidden />
            Revenue intelligence
          </div>
          <div>
            <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Your pipeline, in one live command center.
            </h1>
            <p className="mt-4 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
              Track collection health, spot outstanding invoices, and explore performance by region without
              leaving this dashboard.
            </p>
          </div>

          <Tabs defaultValue="live" className="w-full max-w-md">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="live">Live metrics</TabsTrigger>
              <TabsTrigger value="forecast">Workflows</TabsTrigger>
            </TabsList>
            <TabsContent value="live" className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              Period filters in the header slice every chart and KPI below — switch ranges anytime.
            </TabsContent>
            <TabsContent value="forecast" className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              Export CSV from the sidebar, print memos from receivables, and keep your shops ledger aligned.
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="default" size="default" className="gap-2" onClick={onPrimaryAction}>
              <span>Jump to overview</span>
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <a
              href="https://unsplash.com/photos/laptops-partnership-meeting"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "default" }))}
            >
              View sample context
            </a>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <Card className="relative w-full max-w-lg overflow-hidden border-2 border-border/60 bg-card/95 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
            <BorderBeam
              size={250}
              duration={12}
              borderWidth={2}
              colorFrom="#6366f1"
              colorTo="#a855f7"
              delay={0}
            />
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Snapshot</CardTitle>
              <CardDescription>Real-time feel, powered by your Supabase invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pb-6">
              <div className="overflow-hidden rounded-lg border border-border/80">
                <img
                  src={HERO_IMG}
                  alt="Analytics workspace"
                  className="h-48 w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <img
                  src={HERO_IMG_SECONDARY}
                  alt="Team collaboration"
                  className="h-24 w-full rounded-md object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <div className="flex h-24 flex-col justify-center rounded-md border border-border/80 bg-muted/30 p-3 text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Momentum
                  </p>
                  <p className="text-sm font-bold text-foreground">Collections-first</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
