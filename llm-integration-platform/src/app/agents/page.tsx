'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';

export default function AgentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/pipeline?tab=agent');
  }, [router]);
  return (
    <>
      <Header title="Agents" subtitle="AI-powered model recommendations" />
    </>
  );
}
