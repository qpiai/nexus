'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/header';
import { Smartphone, Download, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DevicesPanel } from '@/components/monitor/devices-panel';
import { DownloadsPanel } from '@/components/monitor/downloads-panel';
import { MetricsPanel } from '@/components/monitor/metrics-panel';

const TABS = [
  { id: 'devices', label: 'Devices', icon: Smartphone, color: 'text-cyan-400' },
  { id: 'downloads', label: 'Downloads', icon: Download, color: 'text-teal-400' },
  { id: 'metrics', label: 'Metrics', icon: Activity, color: 'text-rose-400' },
] as const;

type TabId = typeof TABS[number]['id'];

function MonitorContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabId) || 'devices';
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some(t => t.id === initialTab) ? initialTab : 'devices'
  );

  const handleSwitchTab = useCallback((tab: string) => {
    if (TABS.some(t => t.id === tab)) {
      setActiveTab(tab as TabId);
      window.history.replaceState(null, '', `/monitor?tab=${tab}`);
    }
  }, []);

  return (
    <>
      <Header title="Monitor" subtitle="Devices, downloads & telemetry" />
      <div className="px-4 md:px-6 lg:px-8 pt-4">
        {/* Tab Bar */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleSwitchTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 select-none',
                  isActive
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/80'
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? tab.color : '')} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'devices' && <DevicesPanel />}
      {activeTab === 'downloads' && <DownloadsPanel />}
      {activeTab === 'metrics' && <MetricsPanel />}
    </>
  );
}

export default function MonitorPage() {
  return (
    <Suspense>
      <MonitorContent />
    </Suspense>
  );
}
