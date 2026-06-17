import { motion, AnimatePresence } from 'framer-motion';

interface ProgressBarProps {
  visible: boolean;
  label?: string;
}

export function ProgressBar({ visible, label }: ProgressBarProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="fixed top-0 left-0 right-0 z-50"
        >
          <div className="h-0.5 bg-zinc-800">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 bg-[length:200%_100%]"
              animate={{ backgroundPosition: ['0% 0%', '100% 0%', '0% 0%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          {label && (
            <div className="bg-zinc-950/80 text-xs text-zinc-400 px-3 py-1 text-center">
              {label}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
