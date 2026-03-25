'use client';

import { useState, useEffect, FormEvent, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import {
  Shield, Users, Box, Trash2, UserPlus, ChevronDown, Clock,
  Mail, KeyRound, Activity, Search,
} from 'lucide-react';
import { getAvatarSrc } from '@/lib/constants';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  provider: 'local' | 'google';
  avatar?: string;
  createdAt: number;
  lastLoginAt: number;
}

interface Stats {
  totalUsers: number;
  localUsers: number;
  googleUsers: number;
  totalModels: number;
}

function getInitialColor(name: string): string {
  const colors = [
    'bg-primary', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500',
    'bg-cyan-500', 'bg-pink-500', 'bg-amber-500', 'bg-indigo-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function timeAgo(ts: number): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(true);
  const [search, setSearch] = useState('');

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState<'user' | 'admin'>('user');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  // Role dropdown
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null);
  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/stats'),
      ]);

      if (usersRes.status === 403 || usersRes.status === 401) {
        setIsAdmin(false);
        router.push('/');
        return;
      }

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleAddUser(e: FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addEmail, name: addName, password: addPassword, role: addRole }),
      });
      if (res.ok) {
        setShowAddForm(false);
        setAddEmail(''); setAddName(''); setAddPassword(''); setAddRole('user');
        fetchData();
      } else {
        const data = await res.json();
        setAddError(data.error || 'Failed to create user');
      }
    } catch { setAddError('Network error'); }
    finally { setAddSaving(false); }
  }

  async function handleRoleChange(userId: string, newRole: 'admin' | 'user') {
    setRoleDropdown(null);
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    });
    fetchData();
  }

  async function handleDeleteUser(userId: string) {
    setDeleteConfirm(null);
    await fetch(`/api/admin/users?userId=${userId}`, { method: 'DELETE' });
    fetchData();
  }

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  // Sort: admins first, then by most recent login
  const sorted = [...filtered].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return (b.lastLoginAt || 0) - (a.lastLoginAt || 0);
  });

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header title="Admin" subtitle="Platform Management" />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header title="Admin" subtitle="Platform Management" />
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-primary' },
              { label: 'Local Accounts', value: stats.localUsers, icon: KeyRound, color: 'text-emerald-400' },
              { label: 'Google Accounts', value: stats.googleUsers, icon: Mail, color: 'text-blue-400' },
              { label: 'Quantized Models', value: stats.totalModels, icon: Box, color: 'text-violet-400' },
            ].map(card => (
              <div key={card.label} className="glass rounded-xl p-4 glow-sm relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />
                <div className="flex items-center gap-2 mb-1.5">
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                  <span className="text-[11px] text-muted-foreground font-medium">{card.label}</span>
                </div>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Users Section */}
        <div className="glass rounded-2xl glow-sm relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px nexus-gradient" />

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">Users</h3>
              <span className="text-[10px] text-muted-foreground bg-accent/80 px-2 py-0.5 rounded-full">{users.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative hidden sm:block">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search users..."
                  className="pl-8 h-8 w-48 text-xs"
                />
              </div>
              <Button
                size="sm"
                onClick={() => { setShowAddForm(!showAddForm); setAddError(''); }}
                variant={showAddForm ? 'secondary' : 'default'}
                className={showAddForm ? '' : 'nexus-gradient border-0 text-white'}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                {showAddForm ? 'Cancel' : 'Add User'}
              </Button>
            </div>
          </div>

          {/* Mobile Search */}
          <div className="sm:hidden p-3 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search users..."
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>

          {/* Add User Form */}
          {showAddForm && (
            <div className="p-4 border-b border-border/40 bg-accent/20">
              <form onSubmit={handleAddUser} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1 font-medium">Name</label>
                    <Input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Full name" required className="h-9" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1 font-medium">Email</label>
                    <Input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="user@example.com" required className="h-9" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1 font-medium">Password</label>
                    <Input type="password" value={addPassword} onChange={e => setAddPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} className="h-9" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1 font-medium">Role</label>
                    <select
                      value={addRole}
                      onChange={e => setAddRole(e.target.value as 'admin' | 'user')}
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={addSaving} size="sm" className="nexus-gradient border-0 text-white">
                    {addSaving ? 'Creating...' : 'Create User'}
                  </Button>
                  {addError && <p className="text-xs text-destructive">{addError}</p>}
                </div>
              </form>
            </div>
          )}

          {/* Users List */}
          <div className="divide-y divide-border/30">
            {sorted.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-4 hover:bg-accent/20 transition-colors group">
                {/* Avatar */}
                {(() => {
                  const src = getAvatarSrc(u.avatar);
                  return src ? (
                    <Image src={src} alt={u.name} width={40} height={40} className="h-10 w-10 rounded-xl shrink-0 shadow-sm" />
                  ) : (
                    <div className={`h-10 w-10 rounded-xl ${getInitialColor(u.name)} flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm`}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                  );
                })()}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{u.name}</span>
                    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      u.role === 'admin'
                        ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                        : 'bg-muted text-muted-foreground border border-border/50'
                    }`}>
                      {u.role === 'admin' && <Shield className="h-2.5 w-2.5 mr-0.5" />}
                      {u.role}
                    </span>
                    <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full ${
                      u.provider === 'google'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {u.provider}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</p>
                </div>

                {/* Activity */}
                <div className="hidden md:flex flex-col items-end shrink-0 gap-0.5">
                  <div className="flex items-center gap-1">
                    <Activity className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-[11px] text-muted-foreground">{timeAgo(u.lastLoginAt)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-[10px] text-muted-foreground/60">Joined {new Date(u.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Role dropdown */}
                  <div className="relative">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-60 group-hover:opacity-100"
                      onClick={() => setRoleDropdown(roleDropdown === u.id ? null : u.id)}
                      title="Change role"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    {roleDropdown === u.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setRoleDropdown(null)} />
                        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[130px] overflow-hidden">
                          <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Set Role</div>
                          <button
                            onClick={() => handleRoleChange(u.id, 'admin')}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 ${u.role === 'admin' ? 'text-amber-500 font-medium' : ''}`}
                          >
                            <Shield className="h-3 w-3" />
                            Admin
                          </button>
                          <button
                            onClick={() => handleRoleChange(u.id, 'user')}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 ${u.role === 'user' ? 'text-primary font-medium' : ''}`}
                          >
                            <Users className="h-3 w-3" />
                            User
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Delete */}
                  <div className="relative">
                    {deleteConfirm === u.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-[11px] px-2"
                          onClick={() => handleDeleteUser(u.id)}
                        >
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px] px-2"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 opacity-60 group-hover:opacity-100 hover:text-destructive"
                        onClick={() => setDeleteConfirm(u.id)}
                        title="Delete user"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {sorted.length === 0 && (
              <div className="p-12 text-center text-muted-foreground text-sm">
                {search ? 'No users match your search' : 'No users found'}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
