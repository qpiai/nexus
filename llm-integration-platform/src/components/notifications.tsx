'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
  CheckCircle2, AlertCircle, Info, AlertTriangle, X, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---- Types ----

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (type: NotificationType, title: string, message?: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  removeNotification: (id: string) => void;
}

// ---- Context ----

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

// ---- Provider ----

const MAX_NOTIFICATIONS = 50;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const idCounter = useRef(0);

  const addNotification = useCallback((type: NotificationType, title: string, message?: string) => {
    const id = `notif-${Date.now()}-${++idCounter.current}`;
    setNotifications(prev => {
      const next = [{ id, type, title, message, timestamp: Date.now(), read: false }, ...prev];
      return next.slice(0, MAX_NOTIFICATIONS);
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, clearAll, removeNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

// ---- Panel Component (used in Header) ----

const typeConfig = {
  success: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  info: { icon: Info, color: 'text-primary', bg: 'bg-primary/10' },
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, markAllRead, clearAll, removeNotification } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handleClick); };
  }, [open, onClose]);

  useEffect(() => { if (open) markAllRead(); }, [open, markAllRead]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-sm rounded-xl border border-white/[0.06] bg-card shadow-xl z-50 flex flex-col overflow-hidden"
      style={{ animation: 'notif-enter 0.15s ease-out' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-xs font-semibold text-foreground">Notifications</span>
        {notifications.length > 0 && (
          <button
            onClick={clearAll}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* List */}
      <div className="overflow-y-auto max-h-72">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Bell className="h-5 w-5 mb-2 opacity-25" />
            <p className="text-[11px]">No notifications</p>
          </div>
        ) : (
          notifications.map((n) => {
            const cfg = typeConfig[n.type];
            const Icon = cfg.icon;
            return (
              <div
                key={n.id}
                className="group flex items-start gap-2.5 px-4 py-2.5 border-b border-white/[0.06] last:border-0 hover:bg-muted/50 transition-colors"
              >
                <div className={cn('mt-0.5 shrink-0', cfg.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-foreground leading-snug">{n.title}</p>
                  {n.message && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                  )}
                  <p className="text-[9px] text-muted-foreground/50 mt-1">{timeAgo(n.timestamp)}</p>
                </div>
                <button
                  onClick={() => removeNotification(n.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-0.5 shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
