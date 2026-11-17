import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      richColors
      toastOptions={{
        style: { fontSize: '13px' },
      }}
    />
  );
}
