'use client';

// What a transaction is doing, where it can be checked, and when it is done.
//
// The button under the amount says which step is running, and this says which ones have run: an approval that
// confirmed and a deposit still pending are two different facts, and a holder should not have to open a wallet's
// activity tab to tell them apart. Every row links to the explorer from the moment there is a hash.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, Loader2, X, XCircle } from 'lucide-react';
import { wcTx } from '@/lib/chains';

type Toast = { id: number; title: string; hash?: string; state: 'pending' | 'done' | 'failed'; detail?: string };

type Api = {
  start: (title: string) => number;
  hash: (id: number, hash: string) => void;
  done: (id: number, detail?: string) => void;
  fail: (id: number, detail: string) => void;
};

const Ctx = createContext<Api | null>(null);

export function useToasts(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToasts outside ToastProvider');
  return api;
}

let next = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const patch = useCallback((id: number, p: Partial<Toast>) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);
  const drop = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const api = useMemo<Api>(
    () => ({
      start: (title) => {
        const id = next++;
        setToasts((ts) => [...ts.slice(-3), { id, title, state: 'pending' }]);
        return id;
      },
      hash: (id, hash) => patch(id, { hash }),
      done: (id, detail) => {
        patch(id, { state: 'done', detail });
        setTimeout(() => drop(id), 9_000);
      },
      fail: (id, detail) => patch(id, { state: 'failed', detail }),
    }),
    [patch, drop],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[340px] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className="pointer-events-auto rounded-2xl bg-[#fdfaf1] p-4 shadow-[0_1px_3px_rgba(20,50,35,0.10),0_16px_40px_rgba(20,50,35,0.18)] ring-1 ring-[#254839]/10 animate-[toastIn_.18s_ease-out]"
          >
            <div className="flex items-start gap-3">
              {t.state === 'pending' ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-fg-muted" aria-hidden />
              ) : t.state === 'done' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f7d5b]" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b4571f]" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-fg">{t.title}</div>
                <div className="mt-0.5 text-[12px] text-fg-muted break-words">
                  {t.state === 'pending' && !t.hash && 'Waiting for your wallet'}
                  {t.state === 'pending' && t.hash && 'Confirming on Whitechain, about a second'}
                  {t.state !== 'pending' && t.detail}
                </div>
                {t.hash && (
                  <a
                    href={wcTx(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-fg underline-offset-2 hover:underline"
                  >
                    View on the explorer <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
              <button type="button" onClick={() => drop(t.id)} className="text-fg-muted hover:text-fg" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
