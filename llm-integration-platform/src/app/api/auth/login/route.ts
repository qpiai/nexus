import { NextRequest, NextResponse } from 'next/server';
import { createToken, COOKIE_NAME, TOKEN_MAX_AGE } from '@/lib/auth';
import { findUserByIdentifier, verifyPassword, updateLastLogin, ensureAdminUser } from '@/lib/users';

export async function POST(request: NextRequest) {
  try {
    ensureAdminUser();
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Username/email and password are required' }, { status: 400 });
    }

    const user = findUserByIdentifier(email);
    if (!user || !verifyPassword(user, password)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    updateLastLogin(user.id);
    const token = await createToken(user);
    const response = NextResponse.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: request.headers.get('x-forwarded-proto') === 'https',
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
