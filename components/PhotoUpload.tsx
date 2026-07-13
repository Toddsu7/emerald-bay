'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadHullPhoto } from '@/lib/actions/photos';

export function PhotoUpload({
  watercraftId,
  hasPhoto,
}: {
  watercraftId: string;
  hasPhoto: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.set('watercraftId', watercraftId);
    start(async () => {
      const res = await uploadHullPhoto(fd);
      if (!res.ok) setError(res.error);
      else formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="mt-3 flex items-center gap-2">
      <input type="file" name="photo" accept="image/*" className="text-sm" required />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-bay-600 px-3 py-2 text-sm font-medium text-white hover:bg-bay-700 disabled:opacity-50"
      >
        {pending ? 'Uploading…' : hasPhoto ? 'Replace' : 'Upload'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
