import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

interface ToastValue {
  show(message: string): void;
}

const ToastContext = createContext<ToastValue>({ show: () => undefined });

/** One quiet confirmation at a time, announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const show = useCallback((text: string) => {
    counter.current += 1;
    setMessage({ id: counter.current, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3_200);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
        role="status"
        aria-live="polite"
      >
        {message ? (
          <div
            key={message.id}
            className="toast-in pointer-events-auto flex items-center gap-2.5 rounded-[12px] bg-ink px-4 py-3 text-[14px] font-medium text-white shadow-pop"
          >
            <Check className="size-4 text-mint" strokeWidth={2.25} aria-hidden="true" />
            {message.text}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  return useContext(ToastContext);
}
