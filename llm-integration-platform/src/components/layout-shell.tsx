'use client';

import { usePathname } from 'next/navigation';
import { MobileMenuProvider, useSidebarCollapsed } from '@/components/sidebar';
import { Sidebar } from '@/components/sidebar';
import { NotificationProvider } from '@/components/notifications';
import { UserProvider } from '@/components/user-provider';
import { AgentChatProvider, AgentChatPanel, useAgentChat } from '@/components/agent-chat-panel';
import { cn } from '@/lib/utils';

function MainContent({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarCollapsed();
  const { isOpen: agentOpen } = useAgentChat();
  return (
    <main className={cn(
      'min-h-screen relative z-10 transition-[padding] duration-300',
      collapsed ? 'md:pl-16' : 'md:pl-60',
      agentOpen ? 'md:pr-80' : 'md:pr-0'
    )}>
      {children}
    </main>
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <NotificationProvider>
      <UserProvider>
        <MobileMenuProvider>
          <AgentChatProvider>
            <Sidebar />
            <MainContent>{children}</MainContent>
            <AgentChatPanel />
          </AgentChatProvider>
        </MobileMenuProvider>
      </UserProvider>
    </NotificationProvider>
  );
}
