import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

interface SubmitButtonProps extends ButtonProps {
  loading?: boolean;
}

export function SubmitButton({ loading, children, disabled, ...props }: SubmitButtonProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}
