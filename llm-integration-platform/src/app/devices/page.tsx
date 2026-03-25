'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';

export default function DevicesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/monitor?tab=devices');
  }, [router]);
  return (
    <>
      <Header title="Devices" subtitle="Connected devices" />
    </>
  );
}
