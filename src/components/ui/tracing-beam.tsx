import * as React from "react"
import { motion, useScroll, useTransform } from "framer-motion"

import { cn } from "@/lib/utils"

export function TracingBeam({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [svgHeight, setSvgHeight] = React.useState(0)

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  })

  React.useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSvgHeight(el.offsetHeight)
    })
    ro.observe(el)
    setSvgHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])

  const strokeOpacity = useTransform(scrollYProgress, [0.05, 0.2], [0.12, 0.5])

  return (
    <motion.div
      ref={ref}
      className={cn("relative w-full max-w-none mx-auto", className)}
    >
      <div className="absolute -left-4 md:-left-8 top-3 hidden md:block" aria-hidden>
        <div className="ml-[27px] h-4 w-4 rounded-full border border-neutral-200 dark:border-neutral-700 shadow-sm flex items-center justify-center bg-background">
          <div className="h-2 w-2 rounded-full border border-emerald-600 bg-emerald-500" />
        </div>
        {svgHeight > 0 && (
          <svg
            viewBox={`0 0 20 ${svgHeight}`}
            width="20"
            height={svgHeight}
            className="ml-4 block text-slate-300 dark:text-slate-600"
          >
            <motion.path
              d={`M 1 0V -36 l 18 24 V ${svgHeight * 0.8} l -18 24V ${svgHeight}`}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.16}
            />
            <motion.path
              d={`M 1 0V -36 l 18 24 V ${svgHeight * 0.8} l -18 24V ${svgHeight}`}
              fill="none"
              stroke="url(#tracing-gradient)"
              strokeWidth="1.25"
              className="motion-reduce:hidden"
              style={{ opacity: strokeOpacity }}
            />
            <defs>
              <linearGradient
                id="tracing-gradient"
                gradientUnits="userSpaceOnUse"
                x1="0"
                x2="0"
                y1="0"
                y2={svgHeight}
              >
                <stop stopColor="#18CCFC" stopOpacity="0" />
                <stop stopColor="#18CCFC" />
                <stop offset="0.325" stopColor="#6344F5" />
                <stop offset="1" stopColor="#AE48FF" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        )}
      </div>
      <div ref={contentRef}>{children}</div>
    </motion.div>
  )
}
