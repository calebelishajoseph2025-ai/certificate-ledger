import {useEffect, useState} from 'react';

export function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds || seconds <= 0) return;
    const id = window.setInterval(() => {
      setLeft((n) => Math.max(0, n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [seconds]);
  return left;
}
