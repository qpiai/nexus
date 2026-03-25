'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NexusSelect } from '@/components/ui/nexus-select';
import { Header } from '@/components/header';
import Image from 'next/image';
import { ArrowRight, Cpu, HardDrive, MonitorSmartphone, Zap, Brain, Layers, Sparkles } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [deviceName, setDeviceName] = useState('');
  const [ramGB, setRamGB] = useState('');
  const [gpuInfo, setGpuInfo] = useState('');
  const [storageGB, setStorageGB] = useState('');
  const [deviceType, setDeviceType] = useState<string>('laptop');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName || !ramGB || !storageGB) return;
    setSubmitting(true);

    const device = {
      deviceName,
      ramGB: parseFloat(ramGB),
      gpuInfo,
      storageGB: parseFloat(storageGB),
      deviceType,
    };

    sessionStorage.setItem('nexus-device', JSON.stringify(device));
    sessionStorage.setItem('nexus-auto-start', '1');
    router.push('/agents');
  };

  const isValid = deviceName.trim() && ramGB && storageGB;

  return (
    <>
      <Header title="Home" subtitle="Edge intelligence for every device" />
      <div className="min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 md:p-6 lg:p-8 relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 nexus-mesh" />
        <div className="absolute inset-0 grid-pattern opacity-50" />
        <div className="absolute top-1/4 left-1/4 w-64 h-64 md:w-[500px] md:h-[500px] bg-[var(--qpi-blue)]/8 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 md:w-[400px] md:h-[400px] bg-[var(--qpi-magenta)]/8 rounded-full blur-[100px] animate-pulse stagger-6" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-[var(--success)]/5 rounded-full blur-[80px]" />

        <div className="relative z-10 w-full max-w-md 2xl:max-w-lg">
          {/* Logo & Title */}
          <div className="text-center mb-6 md:mb-8 animate-fade-in-up">
            <div className="relative inline-block mb-4 md:mb-6">
              <div className="h-16 w-16 md:h-20 md:w-20 rounded-2xl bg-white/95 dark:bg-white/10 backdrop-blur-sm flex items-center justify-center shadow-xl shadow-primary/20 animate-float overflow-hidden border border-border/30">
                <Image src="/qpiai_logo.jpg" alt="QpiAI" width={64} height={64} className="object-contain" />
              </div>
              <div className="absolute -bottom-1.5 -right-1.5 h-6 w-6 md:h-7 md:w-7 rounded-lg nexus-gradient flex items-center justify-center shadow-md">
                <Sparkles className="h-3 w-3 md:h-3.5 md:w-3.5 text-white" />
              </div>
            </div>
            <h1 className="text-2xl md:text-5xl font-bold tracking-tight mb-1">
              <span className="text-gradient">QpiAI</span>
            </h1>
            <p className="text-base md:text-xl font-semibold text-foreground/80 mb-3 md:mb-4 tracking-wide">Nexus</p>
            <p className="text-muted-foreground text-xs md:text-base max-w-sm mx-auto leading-relaxed">
              Tell us your specs &mdash; we&apos;ll find the perfect LLM.
            </p>
          </div>

          {/* Feature Pills */}
          <div className="flex justify-center gap-2 md:gap-3 mb-6 md:mb-8 animate-fade-in-up stagger-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 rounded-full bg-primary/10 border border-primary/20 text-[11px] md:text-xs text-primary font-medium">
              <Brain className="h-3 w-3" /> AI Agents
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 rounded-full bg-violet-500/10 border border-violet-500/20 text-[11px] md:text-xs text-violet-600 dark:text-violet-400 font-medium">
              <Layers className="h-3 w-3" /> Quantization
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 md:px-3.5 md:py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] md:text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <Zap className="h-3 w-3" /> Edge Deploy
            </div>
          </div>

          {/* Form Card */}
          <Card className="border-border/30 shadow-2xl animate-fade-in-up stagger-3 overflow-hidden backdrop-blur-xl">
            <div className="h-px w-full nexus-gradient" />
            <CardContent className="p-5 md:p-8">
              <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                    <MonitorSmartphone className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                    Device Name
                  </label>
                  <Input
                    className="h-10 md:h-11 text-sm"
                    placeholder="e.g. MacBook Pro M3, Galaxy S24"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                      <Cpu className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                      RAM (GB)
                    </label>
                    <Input
                      className="h-10 md:h-11 text-sm"
                      type="number"
                      placeholder="e.g. 16"
                      value={ramGB}
                      onChange={(e) => setRamGB(e.target.value)}
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                      <HardDrive className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                      Storage (GB)
                    </label>
                    <Input
                      className="h-10 md:h-11 text-sm"
                      type="number"
                      placeholder="e.g. 512"
                      value={storageGB}
                      onChange={(e) => setStorageGB(e.target.value)}
                      min="1"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">
                    <Zap className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                    GPU Info
                    <span className="text-muted-foreground/50 normal-case tracking-normal ml-1 font-normal">optional</span>
                  </label>
                  <Input
                    className="h-10 md:h-11 text-sm"
                    placeholder="e.g. NVIDIA RTX 4090, Apple M3 GPU"
                    value={gpuInfo}
                    onChange={(e) => setGpuInfo(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-2 block uppercase tracking-wider">Device Type</label>
                  <NexusSelect
                    value={deviceType}
                    onChange={setDeviceType}
                    icon={<MonitorSmartphone className="h-4 w-4" />}
                    options={[
                      { value: 'mobile', label: 'Mobile', description: 'Smartphone or tablet' },
                      { value: 'laptop', label: 'Laptop', description: 'Portable workstation' },
                      { value: 'desktop', label: 'Desktop', description: 'Desktop workstation' },
                      { value: 'edge', label: 'Edge Device', description: 'IoT or embedded system' },
                      { value: 'server', label: 'Server', description: 'Cloud or rack server' },
                    ]}
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full mt-2 nexus-gradient border-0 text-white font-semibold h-11 md:h-12 text-sm md:text-base"
                  disabled={!isValid || submitting}
                >
                  {submitting ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing...
                    </div>
                  ) : (
                    <>
                      Find Optimal Model
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-[11px] text-muted-foreground/60 mt-6 md:mt-8 animate-fade-in-up stagger-4">
            Powered by QpiAI Nexus
          </p>
        </div>
      </div>
    </>
  );
}
