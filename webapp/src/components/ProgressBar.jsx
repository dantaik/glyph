import { useCallback, useEffect, useRef, useState } from 'react';

/** Fixed 2px reading-progress bar; scaleX driven by scroll over targetRef */
export default function ProgressBar({ targetRef }) {
  const [progress, setProgress] = useState(0);
  const frame = useRef(0);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const el = targetRef?.current;
      if (!el) {
        setProgress(0);
        return;
      }
      const rect = el.getBoundingClientRect();
      const targetTop = rect.top + window.scrollY;
      const targetHeight = rect.height;
      const raw =
        targetHeight > 0
          ? (window.scrollY + window.innerHeight - targetTop) / targetHeight
          : 0;
      setProgress(Math.min(1, Math.max(0, raw)));
    });
  }, [targetRef]);

  useEffect(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame.current) {
        window.cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
    };
  }, [schedule]);

  useEffect(schedule);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px]"
      aria-hidden="true"
    >
      <div
        className="h-full bg-accent origin-left"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
