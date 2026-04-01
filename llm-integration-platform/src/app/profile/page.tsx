'use client';

import { useState, useEffect, FormEvent } from 'react';
import Image from 'next/image';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Pencil, X, Eye, EyeOff, Shield, User, Upload } from 'lucide-react';
import { AVATAR_OPTIONS, getAvatarSrc } from '@/lib/constants';
import { useUser } from '@/components/user-provider';

function getInitialColor(name: string): string {
  const colors = [
    'bg-primary', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500',
    'bg-cyan-500', 'bg-pink-500', 'bg-amber-500', 'bg-indigo-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  provider: 'local' | 'google';
  avatar: string | null;
  createdAt: number;
}

export default function ProfilePage() {
  const { refresh: refreshUserContext } = useUser();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit name state
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  // Avatar state
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        setUser(data);
        setNameValue(data.name);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleNameSave() {
    if (!nameValue.trim()) return;
    setNameSaving(true);
    setNameError('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setEditingName(false);
        refreshUserContext();
      } else {
        const data = await res.json();
        setNameError(data.error || 'Failed to update name');
      }
    } catch {
      setNameError('Network error');
    } finally {
      setNameSaving(false);
    }
  }

  async function handleAvatarSelect(avatarId: string) {
    if (!user || avatarSaving) return;
    // Optimistic update
    const prev = user.avatar;
    setUser({ ...user, avatar: avatarId });
    setAvatarSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: avatarId }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        refreshUserContext();
      } else {
        // Revert on failure
        setUser(u => u ? { ...u, avatar: prev } : u);
      }
    } catch {
      setUser(u => u ? { ...u, avatar: prev } : u);
    } finally {
      setAvatarSaving(false);
    }
  }

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }
    if (file.size > 200 * 1024) {
      setUploadError('Image must be under 200KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      handleAvatarSelect(dataUri);
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match');
      return;
    }

    setPwSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        setPwSuccess('Password updated successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await res.json();
        setPwError(data.error || 'Failed to change password');
      }
    } catch {
      setPwError('Network error');
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header title="Profile" />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header title="Profile" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Failed to load profile</p>
        </div>
      </div>
    );
  }

  const initial = user.name.charAt(0).toUpperCase();
  const avatarColor = getInitialColor(user.name);
  const avatarSrc = getAvatarSrc(user.avatar ?? undefined);

  return (
    <div className="min-h-screen flex flex-col">
      <Header title="Profile" subtitle="Manage your account" />
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-6">
        {/* Profile Card */}
        <div className="glass rounded-2xl p-6 glow-sm relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
          <div className="flex flex-col sm:flex-row items-center gap-5">
            {avatarSrc?.startsWith('data:image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarSrc}
                alt={user.name}
                className="h-20 w-20 rounded-2xl shadow-lg shrink-0 object-cover"
              />
            ) : avatarSrc ? (
              <Image
                src={avatarSrc}
                alt={user.name}
                width={80}
                height={80}
                className="h-20 w-20 rounded-2xl shadow-lg shrink-0"
              />
            ) : (
              <div className={`h-20 w-20 rounded-2xl ${avatarColor} flex items-center justify-center text-white text-3xl font-bold shadow-lg shrink-0`}>
                {initial}
              </div>
            )}
            <div className="flex-1 text-center sm:text-left space-y-1.5">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameValue}
                    onChange={e => setNameValue(e.target.value)}
                    className="max-w-[200px]"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') { setEditingName(false); setNameValue(user.name); } }}
                  />
                  <Button size="icon" variant="ghost" onClick={handleNameSave} disabled={nameSaving}>
                    <Check className="h-4 w-4 text-emerald-500" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { setEditingName(false); setNameValue(user.name); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 justify-center sm:justify-start">
                  <h2 className="text-xl font-bold">{user.name}</h2>
                  <button onClick={() => setEditingName(true)} className="text-muted-foreground hover:text-foreground transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${user.role === 'admin' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-primary/10 text-primary border border-primary/20'}`}>
                  {user.role === 'admin' ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  {user.role === 'admin' ? 'Admin' : 'User'}
                </span>
                <span className="text-xs text-muted-foreground capitalize">{user.provider} account</span>
              </div>
            </div>
          </div>
        </div>

        {/* Avatar Picker */}
        <div className="glass rounded-2xl p-6 glow-sm relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
          <h3 className="text-sm font-semibold mb-4">Choose Your Avatar</h3>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {AVATAR_OPTIONS.map((opt) => {
              const isSelected = user.avatar === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleAvatarSelect(opt.id)}
                  disabled={avatarSaving}
                  className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all duration-200 w-[88px] ${
                    isSelected
                      ? `${opt.color} shadow-lg bg-accent/50`
                      : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-accent/30'
                  } disabled:opacity-50`}
                >
                  {isSelected && (
                    <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center z-10">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  )}
                  <Image
                    src={opt.src}
                    alt={opt.label}
                    width={64}
                    height={64}
                    className={`rounded-xl transition-transform duration-200 ${isSelected ? 'scale-105' : 'hover:scale-105'}`}
                  />
                  <span className={`text-[11px] font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}

            {/* Upload custom avatar */}
            <label
              className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 border-dashed transition-all duration-200 w-[88px] cursor-pointer ${
                user.avatar?.startsWith('data:image/')
                  ? 'border-primary shadow-lg bg-accent/50'
                  : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-accent/30'
              } ${avatarSaving ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {user.avatar?.startsWith('data:image/') && (
                <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center z-10">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="sr-only"
              />
              {user.avatar?.startsWith('data:image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar}
                  alt="Custom"
                  className="h-16 w-16 rounded-xl object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-xl bg-muted/50 flex items-center justify-center">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <span className="text-[11px] font-medium text-muted-foreground">Upload</span>
            </label>
          </div>
          {uploadError && (
            <p className="text-xs text-destructive mt-3 text-center">{uploadError}</p>
          )}
        </div>

        {/* Account Details */}
        <div className="glass rounded-2xl p-6 glow-sm relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
          <h3 className="text-sm font-semibold mb-4">Account Details</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-white/[0.06]">
              <span className="text-sm text-muted-foreground">Member since</span>
              <span className="text-sm font-medium">{new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/[0.06]">
              <span className="text-sm text-muted-foreground">Authentication</span>
              <span className="text-sm font-medium capitalize">{user.provider === 'google' ? 'Google OAuth' : 'Email & Password'}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">User ID</span>
              <span className="text-xs font-mono text-muted-foreground">{user.id.slice(0, 8)}...{user.id.slice(-4)}</span>
            </div>
          </div>
        </div>

        {/* Change Password (local users only) */}
        {user.provider === 'local' && (
          <div className="glass rounded-2xl p-6 glow-sm relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
            <h3 className="text-sm font-semibold mb-4">Change Password</h3>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Current Password</label>
                <div className="relative">
                  <Input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    required
                    className="pr-10"
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                    {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">New Password</label>
                <div className="relative">
                  <Input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                    {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Confirm New Password</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
              {pwError && (
                <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">{pwError}</div>
              )}
              {pwSuccess && (
                <div className="text-xs text-emerald-500 bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/20">{pwSuccess}</div>
              )}
              <Button type="submit" disabled={pwSaving} className="nexus-gradient border-0 text-white">
                {pwSaving ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
