'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';

export default function QuantizeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/pipeline?tab=quantize');
  }, [router]);
  return (
    <>
      <Header title="Quantize" subtitle="Model quantization" />
    </>
  );
}
