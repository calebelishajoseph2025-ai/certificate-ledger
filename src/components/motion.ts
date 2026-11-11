export {AnimatePresence, motion, useReducedMotion} from 'motion/react';

export const fadeUp = {
  initial: {opacity: 0, y: 12},
  animate: {opacity: 1, y: 0},
  exit: {opacity: 0, y: 8},
  transition: {duration: 0.35, ease: [0.22, 1, 0.36, 1] as const},
};

export const fade = {
  initial: {opacity: 0},
  animate: {opacity: 1},
  exit: {opacity: 0},
  transition: {duration: 0.2},
};

export const stamp = {
  initial: {scale: 1.4, opacity: 0, rotate: -8},
  animate: {scale: 1, opacity: 1, rotate: -6},
  transition: {type: 'spring' as const, stiffness: 260, damping: 18},
};
