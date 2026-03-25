'use client';

import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentChat } from '@/components/agent-chat-panel';
import { cn } from '@/lib/utils';

export function AgentChatToggle() {
  const { isOpen, togglePanel } = useAgentChat();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={togglePanel}
      aria-label="Toggle Nexus Agent"
      title="Nexus Agent (Ctrl+.)"
      className={cn(
        'text-muted-foreground hover:text-foreground relative',
        isOpen && 'text-primary'
      )}
    >
      <Bot className="h-4 w-4" />
      {isOpen && (
        <span className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </Button>
  );
}
