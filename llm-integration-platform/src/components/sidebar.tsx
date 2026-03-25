'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Sparkles, Layers, ChevronLeft, ChevronRight,
  MessageSquare, Rocket, Activity, Menu, X, Zap, Sun, Moon, LogOut, Eye, Shield, Loader2,
} from 'lucide-react';
import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { useTheme } from '@/components/theme-provider';
import { useUser } from '@/components/user-provider';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Sparkles, color: 'text-primary' },
  { href: '/pipeline', label: 'Pipeline', icon: Layers, color: 'text-violet-400' },
  { href: '/chat', label: 'Chat', icon: MessageSquare, color: 'text-emerald-400' },
  { href: '/vision', label: 'Vision', icon: Eye, color: 'text-amber-400' },
  { href: '/deploy', label: 'Deploy', icon: Rocket, color: 'text-orange-400' },
  { href: '/monitor', label: 'Monitor', icon: Activity, color: 'text-cyan-400' },
];

// Context to share mobile menu + sidebar collapsed state
const SidebarContext = createContext<{
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}>({ mobileOpen: false, setMobileOpen: () => {}, collapsed: false, setCollapsed: () => {} });

export function MobileMenuProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useMobileMenu() {
  return useContext(SidebarContext);
}

export function useSidebarCollapsed() {
  const { collapsed } = useContext(SidebarContext);
  return collapsed;
}

export function MobileMenuButton() {
  const { mobileOpen, setMobileOpen } = useMobileMenu();
  return (
    <button
      onClick={() => setMobileOpen(!mobileOpen)}
      className="md:hidden p-2 rounded-xl hover:bg-accent text-muted-foreground transition-colors"
      aria-label="Toggle menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { mobileOpen, setMobileOpen, collapsed, setCollapsed } = useMobileMenu();
  const { theme, toggleTheme } = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const { user } = useUser();
  const userInfo = user ? { name: user.name, role: user.role } : null;

  // Active tasks polling
  interface ActiveTask {
    type: string;
    label: string;
    progress: number;
    tab: string;
  }
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);

  useEffect(() => {
    async function fetchTasks() {
      try {
        const res = await fetch('/api/tasks/active');
        if (res.ok) {
          const data = await res.json();
          setActiveTasks(data.tasks || []);
        }
      } catch { /* ignore */ }
    }

    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if fetch fails, still redirect to login
    }
    window.location.href = '/login';
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), [setMobileOpen]);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-14 md:h-16 items-center border-b border-border/40 px-4">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-white/95 dark:bg-white/10 flex items-center justify-center shadow-lg shadow-primary/20 backdrop-blur-sm overflow-hidden">
              <Image src="/qpiai_logo.jpg" alt="QpiAI" width={32} height={32} className="object-contain" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-sm tracking-tight text-gradient">QpiAI</span>
                <span className="text-[10px] text-muted-foreground font-medium">Nexus</span>
              </div>
              <span className="text-[9px] text-muted-foreground/50 -mt-0.5 tracking-wide">Edge Intelligence</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto h-9 w-9 rounded-xl bg-white/95 dark:bg-white/10 flex items-center justify-center shadow-lg shadow-primary/20 backdrop-blur-sm overflow-hidden">
            <Image src="/qpiai_logo.jpg" alt="QpiAI" width={32} height={32} className="object-contain" />
          </div>
        )}
        {/* Collapse button: desktop only */}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hidden md:block ml-auto transition-colors"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Close button: mobile only */}
        <button
          onClick={closeMobile}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground ml-auto md:hidden transition-colors"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-3 flex-1">
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground mx-auto mb-2 hidden md:block transition-colors"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMobile}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors duration-150 relative select-none',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-primary/10 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground active:bg-accent'
              )}
              title={collapsed ? item.label : undefined}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-primary" />
              )}
              <div className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 pointer-events-none transition-colors',
                isActive ? 'bg-primary/10' : 'bg-transparent group-hover:bg-accent/50'
              )}>
                <item.icon className={cn(
                  'h-[18px] w-[18px] transition-colors',
                  isActive ? item.color : 'group-hover:text-foreground'
                )} />
              </div>
              {(!collapsed || mobileOpen) && <span className="pointer-events-none">{item.label}</span>}
            </Link>
          );
        })}
        {/* Admin nav link — only visible to admins */}
        {userInfo?.role === 'admin' && (
          <>
            <div className="my-1 border-t border-border/30" />
            <Link
              href="/admin"
              onClick={closeMobile}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors duration-150 relative select-none',
                collapsed && 'justify-center px-0',
                pathname === '/admin'
                  ? 'bg-primary/10 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground active:bg-accent'
              )}
              title={collapsed ? 'Admin' : undefined}
              aria-current={pathname === '/admin' ? 'page' : undefined}
            >
              {pathname === '/admin' && (
                <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-primary" />
              )}
              <div className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 pointer-events-none transition-colors',
                pathname === '/admin' ? 'bg-primary/10' : 'bg-transparent group-hover:bg-accent/50'
              )}>
                <Shield className={cn(
                  'h-[18px] w-[18px] transition-colors',
                  pathname === '/admin' ? 'text-amber-400' : 'group-hover:text-foreground'
                )} />
              </div>
              {(!collapsed || mobileOpen) && <span className="pointer-events-none">Admin</span>}
            </Link>
          </>
        )}

        {/* Running Tasks Indicator */}
        {activeTasks.length > 0 && (
          <>
            <div className="my-2 border-t border-border/30" />
            {(!collapsed || mobileOpen) ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">Running Tasks</p>
                {activeTasks.map((task, i) => (
                  <Link
                    key={`${task.type}-${i}`}
                    href={task.tab === 'vision' ? '/vision' : '/pipeline'}
                    onClick={(e) => {
                      closeMobile();
                      // Store desired tab for pipeline page
                      if (task.tab !== 'vision') {
                        sessionStorage.setItem('nexus-pipeline-tab', task.tab);
                      }
                      // If already on the target page, force a tab switch via custom event
                      const targetPath = task.tab === 'vision' ? '/vision' : '/pipeline';
                      if (pathname === targetPath) {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent('nexus-switch-tab', { detail: task.tab }));
                      }
                    }}
                    className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5 hover:bg-accent/80 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                      <span className="text-xs font-medium text-foreground truncate">{task.label}</span>
                    </div>
                    {task.progress >= 0 ? (
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 nexus-gradient"
                          style={{ width: `${Math.max(2, task.progress * 100)}%` }}
                        />
                      </div>
                    ) : (
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div className="h-full w-1/3 rounded-full nexus-gradient animate-pulse" />
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex justify-center" title={`${activeTasks.length} task${activeTasks.length > 1 ? 's' : ''} running`}>
                <div className="relative">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
                </div>
              </div>
            )}
          </>
        )}
      </nav>

      {/* Theme toggle + Status footer */}
      <div className="p-3 mt-auto space-y-2.5">
        {/* Theme Toggle */}
        {(!collapsed || mobileOpen) ? (
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-accent/80 hover:text-foreground active:bg-accent transition-colors duration-150"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="h-[18px] w-[18px] text-amber-400" />
            ) : (
              <Moon className="h-[18px] w-[18px] text-indigo-400" />
            )}
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        ) : (
          <button
            onClick={toggleTheme}
            className="mx-auto flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent/80 hover:text-foreground active:bg-accent transition-colors duration-150"
            title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="h-[18px] w-[18px] text-amber-400" />
            ) : (
              <Moon className="h-[18px] w-[18px] text-indigo-400" />
            )}
          </button>
        )}

        {/* Logout */}
        {(!collapsed || mobileOpen) ? (
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 transition-colors duration-150 disabled:opacity-50"
          >
            <LogOut className="h-[18px] w-[18px]" />
            <span>{loggingOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        ) : (
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mx-auto flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 transition-colors duration-150 disabled:opacity-50"
            title="Sign Out"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        )}

        {/* Status */}
        {(!collapsed || mobileOpen) && (
          <div className="rounded-xl border border-border/40 bg-accent/50 p-3.5 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
            <div className="flex items-center gap-2 mb-1.5">
              <div className="relative">
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
                <div className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <span className="text-xs font-semibold text-emerald-400">System Online</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">QpiAI Nexus &middot; Edge Intelligence</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen bg-card transition-all duration-300 hidden md:block border-r border-border/40',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden animate-fade-in"
          onClick={closeMobile}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-72 bg-card transition-transform duration-300 ease-out md:hidden border-r border-border/40 shadow-2xl',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
