'use client';

import { useState } from 'react';

interface Props {
  thumbUrl: string | null;
  /** Full-size original — loaded ONLY when the lightbox opens (enlargeable). */
  photoUrl?: string | null;
  sticker: number;
  craftType: string;
  householdName?: string;
  size?: number;
  enlargeable?: boolean;
}

// Small hull thumbnail. Serves the pre-generated ~128px WebP (never the full-size
// original in a list). Hulls without a photo get a neutral placeholder — never a
// broken image. On Lake Status the thumbnail is tappable → full-size lightbox.
export function HullThumb({
  thumbUrl,
  photoUrl,
  sticker,
  craftType,
  householdName,
  size = 40,
  enlargeable = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const inner = thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbUrl}
      alt={`Watercraft #${sticker}`}
      width={size}
      height={size}
      loading="lazy"
      className="rounded-md object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <Placeholder size={size} />
  );

  if (!enlargeable) return <span className="inline-flex shrink-0">{inner}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge photo of #${sticker}`}
        className="inline-flex shrink-0 rounded-md ring-bay-500 focus:outline-none focus:ring-2"
      >
        {inner}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-full w-full max-w-lg overflow-auto rounded-xl bg-white p-3 dark:bg-slate-900"
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt={`Watercraft #${sticker}`}
                className="mx-auto max-h-[70vh] w-auto rounded-lg"
              />
            ) : (
              <div className="p-10 text-center text-slate-400">No photo uploaded.</div>
            )}
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-3xl font-bold tabular-nums text-bay-700 dark:text-bay-400">
                #{sticker}
              </span>
              <span className="text-right text-sm text-slate-500">
                {craftType}
                {householdName ? (
                  <>
                    <br />
                    {householdName}
                  </>
                ) : null}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Placeholder({ size }: { size: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-md bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 14h16l-1.8 3.5a1 1 0 0 1-.9.5H6.7a1 1 0 0 1-.9-.5L4 14Z" />
        <path d="M7 14V6l7 2.5" />
        <path d="M7 6l4-3" />
      </svg>
    </span>
  );
}
