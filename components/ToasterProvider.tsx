'use client';

import { Toaster } from 'sonner';

export default function ToasterProvider() {
  return (
    <Toaster
      richColors
      closeButton
      toastOptions={{
        duration: 3500,
      }}
    />
  );
}

