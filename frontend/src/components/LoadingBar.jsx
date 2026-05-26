import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';

const LoadingContext = createContext();

export function useLoading() {
  return useContext(LoadingContext);
}

export function LoadingProvider({ children }) {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount(c => c + 1), []);
  const decrement = useCallback(() => setCount(c => Math.max(0, c - 1)), []);

  return (
    <LoadingContext.Provider value={{ loading: count > 0, increment, decrement }}>
      {children}
    </LoadingContext.Provider>
  );
}

const DELAY_MS = 350;

export function LoadingBar() {
  const { loading } = useLoading();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const delayRef = useRef(null);

  useEffect(() => {
    if (loading) {
      delayRef.current = setTimeout(() => {
        setVisible(true);
        setProgress(15);
        intervalRef.current = setInterval(() => {
          setProgress(p => {
            if (p >= 90) return p;
            return p + (90 - p) * 0.1;
          });
        }, 200);
      }, DELAY_MS);
    } else {
      clearTimeout(delayRef.current);
      if (visible) {
        setProgress(100);
        clearInterval(intervalRef.current);
        timeoutRef.current = setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 300);
      }
    }

    return () => {
      clearTimeout(delayRef.current);
      clearInterval(intervalRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [loading]);

  if (!visible) return null;

  return (
    <div className="global-loading-bar">
      <div
        className="global-loading-bar-progress"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
