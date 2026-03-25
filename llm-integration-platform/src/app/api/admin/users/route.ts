import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, createToken, COOKIE_NAME, TOKEN_MAX_AGE } from '@/lib/auth';
import { getAllUsers, updateUserRole, updateUserName, deleteUser, findUserByEmail, createUser } from '@/lib/users';

export const dynamic = 'force-dynamic';

async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { user };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const users = getAllUsers();
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    const { email, name, password, role } = await req.json();

    if (!email || !name || !password) {
      return NextResponse.json({ error: 'Email, name, and password are required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    if (findUserByEmail(email)) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const validRole = role === 'admin' ? 'admin' : 'user';
    const user = createUser(email, password, name, 'local', undefined, validRole);

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, provider: user.provider, createdAt: user.createdAt },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  try {
    const { userId, role, name } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (name && typeof name === 'string' && name.trim()) {
      const nameUpdated = updateUserName(userId, name);
      if (!nameUpdated) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    }

    if (role && ['admin', 'user'].includes(role)) {
      const updated = updateUserRole(userId, role);
      if (!updated) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    }

    // If admin changed their own role, refresh the cookie with new role
    if (auth.user && userId === auth.user.userId) {
      const response = NextResponse.json({ success: true });
      const token = await createToken({ id: auth.user.userId, email: auth.user.email, name: auth.user.name, role });
      response.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: req.headers.get('x-forwarded-proto') === 'https',
        sameSite: 'lax',
        path: '/',
        maxAge: TOKEN_MAX_AGE,
      });
      return response;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  if (auth.user && userId === auth.user.userId) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  const deleted = deleteUser(userId);
  if (!deleted) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
