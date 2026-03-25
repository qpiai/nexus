'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';

export default function MetricsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/monitor?tab=metrics');
  }, [router]);
  return (
    <>
      <Header title="Metrics" subtitle="Performance analytics" />
    </>
  );
}
