'use client';

import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NextStepProps {
  label: string;
  description?: string;
  onClick: () => void;
}

export function NextStep({ label, description, onClick }: NextStepProps) {
  return (
    <div className="mt-4 p-3 rounded-lg border border-primary/30 bg-primary/5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <Button size="sm" onClick={onClick} className="gap-1.5 animate-pulse">
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
