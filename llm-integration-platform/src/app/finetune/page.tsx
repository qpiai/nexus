'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';

export default function FinetuneRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/pipeline?tab=finetune');
  }, [router]);
  return (
    <>
      <Header title="Finetune" subtitle="Fine-tune your models" />
    </>
  );
}
