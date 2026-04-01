'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/header';
import { Bot, Brain, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentPanel } from '@/components/pipeline/agent-panel';
import { FinetunePanel } from '@/components/pipeline/finetune-panel';
import { QuantizePanel } from '@/components/pipeline/quantize-panel';

const TABS = [
  { id: 'agent', label: 'Agent', icon: Bot, color: 'text-blue-400' },
  { id: 'finetune', label: 'Finetune', icon: Brain, color: 'text-pink-400' },
  { id: 'quantize', label: 'Quantize', icon: Layers, color: 'text-violet-400' },
] as const;

type TabId = typeof TABS[number]['id'];

function PipelineContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabId) || 'agent';
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some(t => t.id === initialTab) ? initialTab : 'agent'
  );

  const handleSwitchTab = useCallback((tab: string) => {
    if (TABS.some(t => t.id === tab)) {
      setActiveTab(tab as TabId);
      window.history.replaceState(null, '', `/pipeline?tab=${tab}`);
    }
  }, []);

  return (
    <>
      <Header title="Pipeline" subtitle="Build, train & optimize models" />
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
      {activeTab === 'agent' && <AgentPanel onSwitchTab={handleSwitchTab} />}
      {activeTab === 'finetune' && <FinetunePanel onSwitchTab={handleSwitchTab} />}
      {activeTab === 'quantize' && <QuantizePanel onSwitchTab={handleSwitchTab} />}
    </>
  );
}

export default function PipelinePage() {
  return (
    <Suspense>
      <PipelineContent />
    </Suspense>
  );
}
