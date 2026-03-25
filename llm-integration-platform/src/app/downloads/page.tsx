'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';

export default function DownloadsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/monitor?tab=downloads');
  }, [router]);
  return (
    <>
      <Header title="Downloads" subtitle="Model downloads" />
    </>
  );
}
