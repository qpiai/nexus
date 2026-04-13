import { NextRequest, NextResponse } from 'next/server';
import { createToken, COOKIE_NAME, TOKEN_MAX_AGE } from '@/lib/auth';
import { findUserByGoogleId, findUserByEmail, createUser, updateLastLogin, linkGoogleId } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Build external-facing base URL from forwarded headers (for cloudflared tunnel)
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:7777';
  const baseUrl = `${proto}://${host}`;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/login?error=Google+OAuth+not+configured', baseUrl));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, baseUrl));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/login?error=Missing+authorization+code', baseUrl));
  }

  // Verify CSRF state
  const storedState = request.cookies.get('google_oauth_state')?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(new URL('/login?error=Invalid+state+parameter', baseUrl));
  }

  const redirectUri = `${baseUrl}/api/auth/callback/google`;

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/login?error=Failed+to+exchange+code', baseUrl));
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(new URL('/login?error=Failed+to+fetch+profile', baseUrl));
    }

    const profile = await profileRes.json();
    const googleId = profile.id;
    const email = profile.email;
    const name = profile.name || email.split('@')[0];

    // Find or create user
    let user = findUserByGoogleId(googleId);

    if (!user) {
      // Check if a local account exists with this email
      const existingUser = findUserByEmail(email);
      if (existingUser) {
        // Link Google ID to existing account
        linkGoogleId(existingUser.id, googleId);
        user = existingUser;
      } else {
        // Create new Google user
        user = createUser(email, null, name, 'google', googleId);
      }
    } else {
      updateLastLogin(user.id);
    }

    // Issue Nexus JWT and redirect to home
    const token = await createToken(user);
    const response = NextResponse.redirect(new URL('/', baseUrl));

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: request.headers.get('x-forwarded-proto') === 'https',
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_MAX_AGE,
    });

    // Clear OAuth state cookie
    response.cookies.set('google_oauth_state', '', { maxAge: 0, path: '/' });

    return response;
  } catch {
    return NextResponse.redirect(new URL('/login?error=Authentication+failed', baseUrl));
  }
}
