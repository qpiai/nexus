'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell } from 'lucide-react';
import { MobileMenuButton } from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { useNotifications, NotificationPanel } from '@/components/notifications';
import { useUser } from '@/components/user-provider';
import { getAvatarSrc } from '@/lib/constants';
import { AgentChatToggle } from '@/components/agent-chat-toggle';

function getInitialColor(name: string): string {
  const colors = [
    'bg-primary', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500',
    'bg-cyan-500', 'bg-pink-500', 'bg-amber-500', 'bg-indigo-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { unreadCount } = useNotifications();
  const [panelOpen, setPanelOpen] = useState(false);
  const { user, loading } = useUser();

  const togglePanel = useCallback(() => {
    setPanelOpen(prev => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const userName = user?.name || '';
  const initial = userName ? userName.charAt(0).toUpperCase() : '';
  const avatarColor = userName ? getInitialColor(userName) : 'bg-muted';
  const avatarSrc = getAvatarSrc(user?.avatar ?? undefined);

  return (
    <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between border-b border-border/40 bg-background/95 backdrop-blur-md px-3 md:px-6 lg:px-8">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <MobileMenuButton />
        <div className="min-w-0">
          <h1 className="text-sm md:text-lg font-bold tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-[10px] md:text-[11px] text-muted-foreground -mt-0.5 truncate hidden sm:block">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <AgentChatToggle />
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            className="text-muted-foreground hover:text-foreground relative"
            onClick={togglePanel}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
            )}
          </Button>
          <NotificationPanel open={panelOpen} onClose={closePanel} />
        </div>
        <Link href="/profile" aria-label="Profile" className="hidden sm:block">
          {loading ? (
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          ) : avatarSrc ? (
            <Image
              src={avatarSrc}
              alt={userName}
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
            />
          ) : (
            <div className={`h-8 w-8 rounded-lg ${avatarColor} flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:opacity-80 transition-opacity`}>
              {initial}
            </div>
          )}
        </Link>
      </div>
    </header>
  );
}
