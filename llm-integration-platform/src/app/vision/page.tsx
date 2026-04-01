'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/header';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, Brain, Layers, Eye, FolderOpen, Cpu, BarChart3 } from 'lucide-react';
import { VisionAgentPanel } from '@/components/pipeline/vision-agent-panel';
import { VisionFinetunePanel } from '@/components/pipeline/vision-finetune-panel';
import { VisionExportPanel } from '@/components/pipeline/vision-export-panel';
import { VisionInferencePanel } from '@/components/pipeline/vision-inference-panel';

type VisionTab = 'agent' | 'finetune' | 'export' | 'inference';

const TABS = [
  { id: 'agent' as const, label: 'Agent', icon: Bot, color: 'text-blue-400', accent: 'from-blue-400' },
  { id: 'finetune' as const, label: 'Finetune', icon: Brain, color: 'text-pink-400', accent: 'from-pink-400' },
  { id: 'export' as const, label: 'Export', icon: Layers, color: 'text-violet-400', accent: 'from-violet-400' },
  { id: 'inference' as const, label: 'Inference', icon: Eye, color: 'text-emerald-400', accent: 'from-emerald-400' },
];

export default function VisionPage() {
  const [activeTab, setActiveTab] = useState<VisionTab>('agent');
  const [exportedCount, setExportedCount] = useState(0);
  const [datasetCount, setDatasetCount] = useState(0);
  const [trainRunCount, setTrainRunCount] = useState(0);

  // Fetch summary stats
  useEffect(() => {
    fetch('/api/vision/models').then(r => r.json()).then(d => setExportedCount(d.models?.length || 0)).catch(() => {});
    fetch('/api/vision/dataset/list').then(r => r.json()).then(d => setDatasetCount(d.datasets?.length || 0)).catch(() => {});
    fetch('/api/vision/train/runs').then(r => r.json()).then(d => setTrainRunCount(d.runs?.length || 0)).catch(() => {});
  }, [activeTab]);

  const handleSwitchTab = useCallback((tab: string) => {
    setActiveTab(tab as VisionTab);
  }, []);

  return (
    <>
      <Header title="Vision" subtitle="AI-guided YOLO object detection & segmentation" />
      <div className="px-4 py-6 md:px-6 md:py-8 lg:px-8 space-y-6 md:space-y-8 page-container">

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06] w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? `bg-card ${tab.color} shadow-sm`
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/80'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <Card className="animate-fade-in-up stagger-1 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-blue-400 via-blue-400/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-400/20 to-blue-400/5 flex items-center justify-center shadow-sm shadow-blue-400/10 mb-3">
                  <Bot className="h-5 w-5 text-blue-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active Tab</p>
                <p className="text-sm font-bold tracking-tight mt-1 capitalize">{activeTab}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-emerald-500 via-emerald-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center shadow-sm shadow-emerald-500/10 mb-3">
                  <FolderOpen className="h-5 w-5 text-emerald-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Datasets</p>
                <p className="text-sm font-bold tracking-tight mt-1">{datasetCount} prepared</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500 via-violet-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center shadow-sm shadow-violet-500/10 mb-3">
                  <Cpu className="h-5 w-5 text-violet-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Models</p>
                <p className="text-sm font-bold tracking-tight mt-1">{exportedCount} exported</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up stagger-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-pink-500 via-pink-500/60 to-transparent" />
            <CardContent className="p-6 md:p-7">
              <div className="flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-pink-500/20 to-pink-500/5 flex items-center justify-center shadow-sm shadow-pink-500/10 mb-3">
                  <BarChart3 className="h-5 w-5 text-pink-400" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Train Runs</p>
                <p className="text-sm font-bold tracking-tight mt-1">{trainRunCount} completed</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tab Content */}
        {activeTab === 'agent' && <VisionAgentPanel onSwitchTab={handleSwitchTab} />}
        {activeTab === 'finetune' && <VisionFinetunePanel onSwitchTab={handleSwitchTab} />}
        {activeTab === 'export' && <VisionExportPanel onSwitchTab={handleSwitchTab} />}
        {activeTab === 'inference' && <VisionInferencePanel />}
      </div>
    </>
  );
}
