'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { reason } from '@/lib/protocol';

/// Async action button, the same one the Stellar app's steps use: runs `action` (sign, send, wait for the receipt)
/// and shows pending and the error under itself. The toast says the rest.
export function TxButton({
  label,
  action,
  onSuccess,
  disabled,
  fit,
}: {
  label: string;
  action: () => Promise<unknown>;
  onSuccess?: () => void;
  disabled?: boolean;
  /** Width of its own label rather than of whatever box it was dropped in. */
  fit?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      await action();
      onSuccess?.();
    } catch (e) {
      setError(reason(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={clsx('flex flex-col', fit ? 'items-end' : 'w-full')}>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={run}
        className={clsx(
          'h-11 rounded-full text-[14px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          fit ? 'px-6 whitespace-nowrap' : 'w-full',
          'bg-[#254839] text-[#fdf8ed] hover:bg-[#1F3D31]',
        )}
      >
        {pending ? 'Confirming…' : label}
      </button>
      {error && (
        <span
          className={clsx('mt-1.5 text-[11px] text-[#9b2c2c] break-words', fit && 'max-w-[260px] text-right')}
          title={error}
        >
          {error.length > 120 ? error.slice(0, 120) + '...' : error}
        </span>
      )}
    </div>
  );
}
