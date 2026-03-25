import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash?: string; // scrypt "salt:hash" (absent for OAuth-only users)
  provider: 'local' | 'google';
  googleId?: string;
  role: 'admin' | 'user';
  avatar?: string;
  createdAt: number;
  lastLoginAt: number;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadUsers(): User[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    const users: User[] = JSON.parse(data);
    // Migration: assign role to users created before role was added
    let needsSave = false;
    for (let i = 0; i < users.length; i++) {
      if (!users[i].role) {
        users[i].role = i === 0 ? 'admin' : 'user';
        needsSave = true;
      }
    }
    if (needsSave) saveUsers(users);
    return users;
  } catch {
    return [];
  }
}

export function saveUsers(users: User[]): void {
  ensureDataDir();
  // Atomic write: temp file + rename
  const tmpFile = USERS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2), 'utf-8');
  fs.renameSync(tmpFile, USERS_FILE);
}

export function findUserByEmail(email: string): User | undefined {
  const users = loadUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

export function findUserByName(name: string): User | undefined {
  const users = loadUsers();
  return users.find(u => u.name.toLowerCase() === name.toLowerCase());
}

/** Find user by email or username (for login) */
export function findUserByIdentifier(identifier: string): User | undefined {
  return findUserByEmail(identifier) || findUserByName(identifier);
}

export function findUserByGoogleId(googleId: string): User | undefined {
  const users = loadUsers();
  return users.find(u => u.googleId === googleId);
}

export function findUserById(id: string): User | undefined {
  const users = loadUsers();
  return users.find(u => u.id === id);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(user: User, password: string): boolean {
  if (!user.passwordHash) return false;
  const [salt, storedHash] = user.passwordHash.split(':');
  if (!salt || !storedHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === storedHash;
}

export function createUser(
  email: string,
  password: string | null,
  name: string,
  provider: 'local' | 'google',
  googleId?: string,
  role?: 'admin' | 'user'
): User {
  const users = loadUsers();

  const user: User = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    name: name.trim(),
    passwordHash: password ? hashPassword(password) : undefined,
    provider,
    googleId,
    role: role || (users.length === 0 ? 'admin' : 'user'),
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
  };

  users.push(user);
  saveUsers(users);
  return user;
}

export function updateLastLogin(userId: string): void {
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (user) {
    user.lastLoginAt = Date.now();
    saveUsers(users);
  }
}

export function linkGoogleId(userId: string, googleId: string): void {
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (user) {
    user.googleId = googleId;
    user.provider = 'google';
    saveUsers(users);
  }
}

export function getAllUsers(): Omit<User, 'passwordHash'>[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return loadUsers().map(({ passwordHash: _pw, ...rest }) => rest);
}

export function deleteUser(id: string): boolean {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users.splice(idx, 1);
  saveUsers(users);
  return true;
}

export function updateUserRole(id: string, role: 'admin' | 'user'): boolean {
  const users = loadUsers();
  const user = users.find(u => u.id === id);
  if (!user) return false;
  user.role = role;
  saveUsers(users);
  return true;
}

export function updateUserName(id: string, name: string): boolean {
  const users = loadUsers();
  const user = users.find(u => u.id === id);
  if (!user) return false;
  user.name = name.trim();
  saveUsers(users);
  return true;
}

export function updateUserAvatar(id: string, avatar: string): boolean {
  const users = loadUsers();
  const user = users.find(u => u.id === id);
  if (!user) return false;
  user.avatar = avatar;
  saveUsers(users);
  return true;
}

export function updateUserPassword(id: string, newPasswordHash: string): void {
  const users = loadUsers();
  const user = users.find(u => u.id === id);
  if (user) {
    user.passwordHash = newPasswordHash;
    saveUsers(users);
  }
}

/** Ensure a default admin account exists. Called on first login attempt. */
export function ensureAdminUser(): void {
  const users = loadUsers();
  // Check if an "admin" account with password already exists
  const adminByName = users.find(u => u.name.toLowerCase() === 'admin' && u.passwordHash);
  if (adminByName) return;

  // Create a dedicated admin account (login: admin / qpiai-nexus)
  createUser('admin@nexus.local', 'qpiai-nexus', 'admin', 'local', undefined, 'admin');
}
