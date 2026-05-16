import { motion, useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"

export interface BonusesIncentivesCardProps {
  bonusText?: string
  incentivesText?: string
  bonusesValue?: number
  incentivesValue?: number
  borderColor?: string
  backgroundColor?: string
  outerDotsCount?: number
  innerDotsCount?: number
  enableAnimations?: boolean
  onMoreDetails?: () => void
  className?: string
}

const defaultProps: Partial<BonusesIncentivesCardProps> = {
  bonusText: "Bonuses",
  incentivesText: "Incentives",
  bonusesValue: 1250,
  incentivesValue: 875,
  borderColor: "border-border/30",
  backgroundColor: "bg-muted/20",
  outerDotsCount: 48,
  innerDotsCount: 36,
  enableAnimations: true,
}

export function BonusesIncentivesCard(props: BonusesIncentivesCardProps) {
  const {
    bonusText,
    incentivesText,
    bonusesValue,
    incentivesValue,
    borderColor,
    backgroundColor,
    outerDotsCount,
    innerDotsCount,
    enableAnimations,
    onMoreDetails,
    className,
  } = { ...defaultProps, ...props }

  const shouldReduceMotion = useReducedMotion()
  const shouldAnimate = enableAnimations && !shouldReduceMotion

  const generateDots = (count: number, radius: number, centerX: number, centerY: number) => {
    const dots: { x: number; y: number; angle: number; delay: number }[] = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI
      const x = Math.round((centerX + radius * Math.cos(angle)) * 1000) / 1000
      const y = Math.round((centerY + radius * Math.sin(angle)) * 1000) / 1000
      dots.push({ x, y, angle, delay: i * 0.02 })
    }
    return dots
  }

  const outerDots = generateDots(outerDotsCount!, 185, 203, 200)
  const innerDots = generateDots(innerDotsCount!, 155, 203, 200)

  const containerVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: "spring" as const,
        stiffness: 300,
        damping: 30,
        staggerChildren: 0.08,
        delayChildren: 0.1,
      },
    },
  }

  const dotVariants = {
    hidden: { opacity: 0, scale: 0 },
    visible: {
      opacity: 0.6,
      scale: 1,
      transition: { duration: 0.5, ease: "easeOut" as const },
    },
  }

  const total = (bonusesValue ?? 0) + (incentivesValue ?? 0)

  return (
    <motion.div
      className={cn("w-full max-w-md", className)}
      initial={shouldAnimate ? "hidden" : "visible"}
      animate="visible"
      variants={shouldAnimate ? containerVariants : undefined}
    >
      <motion.div
        className={cn(
          "overflow-hidden rounded-xl border shadow-lg",
          backgroundColor,
          borderColor,
        )}
      >
        <div className="relative overflow-hidden pt-8 pr-8 pb-4 pl-4">
          <div
            className={cn(
              "absolute inset-0 rounded-lg backdrop-blur-[2px]",
              backgroundColor,
            )}
          />

          <div className="relative mx-auto h-[28rem] w-[28rem]">
            <svg className="h-full w-full" viewBox="0 0 448 448">
              {outerDots.map((dot, index) => (
                <motion.circle
                  key={`outer-${index}`}
                  cx={dot.x}
                  cy={dot.y}
                  r="10"
                  fill="currentColor"
                  className="text-[#5A8CEF]"
                  variants={shouldAnimate ? dotVariants : undefined}
                  initial="hidden"
                  animate="visible"
                />
              ))}
              {innerDots.map((dot, index) => (
                <motion.circle
                  key={`inner-${index}`}
                  cx={dot.x}
                  cy={dot.y}
                  r="10"
                  fill="currentColor"
                  className="text-[#4B7A63]"
                  variants={shouldAnimate ? dotVariants : undefined}
                  initial="hidden"
                  animate="visible"
                />
              ))}
            </svg>

            <div className="pointer-events-none absolute inset-0 -mt-24 -ml-12 flex items-center justify-center">
              <div className="text-center" style={{ zIndex: 20 }}>
                <motion.div
                  className="mb-2 text-xl font-medium text-foreground"
                  initial={shouldAnimate ? { opacity: 0, y: -10, scale: 0.95 } : false}
                  animate={shouldAnimate ? { opacity: 1, y: 0, scale: 1 } : undefined}
                  transition={{
                    delay: 0.3,
                    type: "spring",
                    stiffness: 400,
                    damping: 25,
                    mass: 0.6,
                  }}
                >
                  TOTAL
                </motion.div>
                <motion.div
                  className="text-5xl font-bold text-foreground"
                  initial={
                    shouldAnimate
                      ? { opacity: 0, y: 20, scale: 0.8, filter: "blur(4px)" }
                      : false
                  }
                  animate={
                    shouldAnimate
                      ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
                      : undefined
                  }
                  transition={{
                    delay: 0.5,
                    type: "spring",
                    stiffness: 300,
                    damping: 28,
                    mass: 0.8,
                  }}
                >
                  {moneyUsd(total)}
                </motion.div>
              </div>
            </div>
          </div>

          <div
            className="pointer-events-none absolute -inset-4 z-[5] rounded-xl bg-gradient-to-b from-transparent from-35% via-card/80 via-45% to-card to-65%"
            aria-hidden
          />

          <div className="absolute right-0 bottom-0 left-0 z-10 px-6 pt-4 pb-2">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <motion.div
                    className="h-4 w-0.5 rounded-full bg-[#5A8CEF]"
                    initial={shouldAnimate ? { opacity: 0, scaleY: 0 } : false}
                    animate={shouldAnimate ? { opacity: 1, scaleY: 1 } : undefined}
                    transition={{ delay: 0.4, type: "spring" }}
                  />
                  <motion.div
                    className="text-sm font-medium text-muted-foreground"
                    initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
                    animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                    transition={{ delay: 0.5 }}
                  >
                    {bonusText}
                  </motion.div>
                </div>
                <div className="flex flex-col">
                  <motion.div
                    className="text-left text-xl font-bold text-foreground"
                    initial={shouldAnimate ? { opacity: 0, y: -10 } : false}
                    animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                    transition={{ delay: 0.6 }}
                  >
                    {moneyUsd(bonusesValue ?? 0)}
                  </motion.div>
                  <motion.div
                    className="text-left text-xs font-medium text-[#5A8CEF]"
                    initial={shouldAnimate ? { opacity: 0, y: -10 } : false}
                    animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                    transition={{ delay: 0.7 }}
                  >
                    Collected
                  </motion.div>
                </div>
              </div>

              <div className="mb-2 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <motion.div
                    className="h-4 w-0.5 rounded-full bg-[#4B7A63]"
                    initial={shouldAnimate ? { opacity: 0, scaleY: 0 } : false}
                    animate={shouldAnimate ? { opacity: 1, scaleY: 1 } : undefined}
                    transition={{ delay: 0.8, type: "spring" }}
                  />
                  <motion.div
                    className="text-sm font-medium text-muted-foreground"
                    initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
                    animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                    transition={{ delay: 0.9 }}
                  >
                    {incentivesText}
                  </motion.div>
                </div>
                <div className="flex flex-col">
                  <motion.div
                    className="text-left text-xl font-bold text-foreground"
                    initial={shouldAnimate ? { opacity: 0, y: -10 } : false}
                    animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                    transition={{ delay: 1.0 }}
                  >
                    {moneyUsd(incentivesValue ?? 0)}
                  </motion.div>
                  <motion.div
                    className="text-left text-xs font-medium text-[#5A8CEF]"
                    initial={shouldAnimate ? { opacity: 0, y: -10 } : false}
                    animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
                    transition={{ delay: 1.1 }}
                  >
                    Outstanding
                  </motion.div>
                </div>
              </div>
            </div>

            <motion.button
              type="button"
              className="mb-4 w-full rounded-lg border border-border bg-transparent px-4 py-2 font-medium text-foreground shadow-sm hover:bg-muted/80"
              initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
              animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
              transition={{ delay: 1.1 }}
              whileHover={shouldAnimate ? { scale: 1.02 } : undefined}
              whileTap={shouldAnimate ? { scale: 0.98 } : undefined}
              onClick={onMoreDetails}
            >
              More details
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function moneyUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}
