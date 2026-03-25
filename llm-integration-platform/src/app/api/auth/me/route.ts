import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { findUserById, updateUserName, updateUserAvatar } from '@/lib/users';
import { isValidAvatarId } from '@/lib/constants';

export const dynamic = 'force-dynamic';

function userJson(user: NonNullable<ReturnType<typeof findUserById>>) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    provider: user.provider,
    avatar: user.avatar ?? null,
    createdAt: user.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const tokenUser = await getUserFromRequest(req);
  if (!tokenUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = findUserById(tokenUser.userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(userJson(user));
}

export async function PATCH(req: NextRequest) {
  const tokenUser = await getUserFromRequest(req);
  if (!tokenUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, avatar } = body;

    // Update name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 });
      }
      if (name.trim().length > 100) {
        return NextResponse.json({ error: 'Name is too long' }, { status: 400 });
      }
      const updated = updateUserName(tokenUser.userId, name);
      if (!updated) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    }

    // Update avatar if provided
    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || !isValidAvatarId(avatar)) {
        return NextResponse.json({ error: 'Invalid avatar' }, { status: 400 });
      }
      const updated = updateUserAvatar(tokenUser.userId, avatar);
      if (!updated) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    }

    const user = findUserById(tokenUser.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json(userJson(user));
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
