import {useEffect} from 'react';

export function useHotkeys(map: Record<string, (event: KeyboardEvent) => void>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const parts = [];
      if (event.metaKey || event.ctrlKey) parts.push('mod');
      if (event.shiftKey) parts.push('shift');
      parts.push(event.key.toLowerCase());
      const combo = parts.join('+');
      const handler = map[combo];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map]);
}
