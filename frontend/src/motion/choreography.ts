import type { Variants, Transition } from 'framer-motion'
import { tokens } from '@/theme/tokens'

const { ease, duration, stagger, blurEnter } = tokens.motion

/** Full-width hero card reveal — fade + lift + de-blur. */
export const heroReveal: Variants = {
  hidden: { opacity: 0, y: 12, filter: `blur(${blurEnter}px)` },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: duration.reveal, ease: ease.cinematic },
  },
}

/** Standard panel enter — subtler than the hero. */
export const panelReveal: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: duration.reveal, ease: ease.cinematic },
  },
}

/** Individual trace row — used with listStagger as parent. Uses `transition`
 *  (0.4s) rather than `reveal` (0.7s) because the perceived time per row is
 *  compounded by the parent's staggerChildren delay. */
export const traceRowEnter: Variants = {
  hidden: { opacity: 0, y: 12, filter: `blur(${blurEnter}px)` },
  visible: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: duration.transition, ease: ease.cinematic },
  },
}

/** Parent variant that staggers child reveals. `hidden` is intentionally empty
 *  — the parent only orchestrates timing; children own their own animations. */
export const listStagger: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren: 0.1 },
  },
}

/** Count-up transition passed to <motion.span animate={{ value: N }}>. */
export const countUpTransition: Transition = {
  duration: duration.count,
  ease: ease.cinematic,
}
