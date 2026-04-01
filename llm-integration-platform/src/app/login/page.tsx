'use client';

import { useState, FormEvent, useEffect } from 'react';
import Image from 'next/image';
import { Eye, EyeOff, UserPlus, LogIn } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(true); // Show immediately, hide if not configured

  useEffect(() => {
    // Check if Google OAuth is configured (non-blocking — button shows instantly)
    fetch('/api/auth/google', { method: 'HEAD', redirect: 'manual' }).then(res => {
      // 501 means GOOGLE_CLIENT_ID is not set — hide button
      if (res.status === 501) setGoogleEnabled(false);
    }).catch(() => setGoogleEnabled(false));

    // Check for error in URL params (from Google OAuth redirect)
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get('error');
    if (urlError) {
      setError(decodeURIComponent(urlError));
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const url = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body = mode === 'signup'
        ? { email, password, name }
        : { email, password };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        window.location.href = '/';
      } else {
        const data = await res.json();
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleLogin() {
    window.location.href = '/api/auth/google';
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 nexus-mesh">
      <div className="w-full max-w-sm">
        <div className="glass rounded-2xl p-8 glow-sm animate-fade-in-up relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
          {/* Header */}
          <div className="flex flex-col items-center mb-6">
            <div className="h-14 w-14 rounded-2xl bg-white/95 dark:bg-white/10 flex items-center justify-center shadow-lg shadow-primary/20 backdrop-blur-sm overflow-hidden mb-4">
              <Image src="/qpiai_logo.jpg" alt="QpiAI" width={48} height={48} className="object-contain" />
            </div>
            <h1 className="text-xl font-bold text-gradient">QpiAI Nexus</h1>
            <p className="text-xs text-muted-foreground mt-1">Edge Intelligence Platform</p>
          </div>

          {/* Mode Toggle */}
          <div className="flex mb-6 bg-white/[0.03] rounded-xl p-1 border border-white/[0.06]">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                mode === 'signin'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                mode === 'signup'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Sign Up
            </button>
          </div>

          {/* Google Sign In */}
          {googleEnabled && (
            <>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handleGoogleLogin}
                className="w-full mb-4 h-11"
              >
                <GoogleIcon />
                <span className="ml-2 text-sm">Continue with Google</span>
              </Button>
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/[0.06]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-3 text-muted-foreground/60">or</span>
                </div>
              </div>
            </>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="name" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Name
                </label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-muted-foreground mb-1.5">
                {mode === 'signup' ? 'Email' : 'Username or Email'}
              </label>
              <Input
                id="email"
                type={mode === 'signup' ? 'email' : 'text'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mode === 'signup' ? 'you@example.com' : 'admin or you@example.com'}
                required
                autoFocus={mode === 'signin'}
                autoComplete={mode === 'signup' ? 'email' : 'username'}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Min 6 characters' : 'Enter password'}
                  required
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className="pr-10"
                  minLength={mode === 'signup' ? 6 : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={loading}
              className="w-full nexus-gradient border-0 text-white font-semibold"
            >
              {loading
                ? (mode === 'signup' ? 'Creating account...' : 'Signing in...')
                : (mode === 'signup' ? 'Create Account' : 'Sign In')
              }
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
