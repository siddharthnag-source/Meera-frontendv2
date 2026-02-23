import type { Transition } from 'framer-motion';

export const premiumEasing = {
  standard: [0.22, 1, 0.36, 1] as const,
  emphasize: [0.16, 1, 0.3, 1] as const,
  decelerate: [0.4, 0, 0.2, 1] as const,
};

export const premiumSprings = {
  snappy: {
    type: 'spring' as const,
    stiffness: 480,
    damping: 36,
    mass: 0.82,
  },
  smooth: {
    type: 'spring' as const,
    stiffness: 360,
    damping: 34,
    mass: 0.9,
  },
  gentle: {
    type: 'spring' as const,
    stiffness: 280,
    damping: 32,
    mass: 1,
  },
};

export const premiumTransitions: Record<string, Transition> = {
  backdrop: {
    duration: 0.22,
    ease: premiumEasing.standard,
  },
  fade: {
    duration: 0.24,
    ease: premiumEasing.standard,
  },
  sheet: {
    duration: 0.34,
    ease: premiumEasing.standard,
  },
  panel: premiumSprings.smooth,
  drawer: premiumSprings.snappy,
  pop: {
    duration: 0.2,
    ease: premiumEasing.emphasize,
  },
};
