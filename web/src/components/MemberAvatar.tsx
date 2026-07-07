/**
 * Shared avatar-with-fallback-chain — Phase 3.5. Used for both the current
 * user and trip members: `photoUrl` (from initData) → `/api/avatar/:userId`
 * proxy (`useAvatarSrc`) → a colored initials circle (three-link fallback).
 *
 * Redesigned onto antd-mobile's `Avatar`; the initials fallback gets a
 * deterministic per-person color so a group of members reads at a glance.
 */
import { Avatar } from 'antd-mobile';

import { useAvatarSrc } from '../api/avatar';
import { AVATAR_COLORS, initials, type AvatarPerson } from '../lib/avatarPerson';

export type AvatarSize = number;

export interface MemberAvatarProps {
  person: AvatarPerson;
  size?: number;
}

function colorFor(person: AvatarPerson): string {
  const seed = Math.abs(person.id) % AVATAR_COLORS.length;
  return AVATAR_COLORS[seed]!;
}

function InitialsCircle({ person, size }: { person: AvatarPerson; size: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorFor(person),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.4),
        fontWeight: 600,
        lineHeight: 1,
        flex: '0 0 auto',
        userSelect: 'none',
      }}
    >
      {initials(person)}
    </div>
  );
}

export function MemberAvatar({ person, size = 40 }: MemberAvatarProps) {
  // Only hit the proxy when there's no direct `photoUrl` to use — no point
  // paying for an authenticated fetch the fallback chain won't even need.
  const proxySrc = useAvatarSrc(person.photoUrl ? undefined : person.id);
  const src = person.photoUrl ?? proxySrc;

  if (!src) {
    return <InitialsCircle person={person} size={size} />;
  }

  return (
    <Avatar
      src={src}
      alt={initials(person)}
      fallback={<InitialsCircle person={person} size={size} />}
      style={{
        '--size': `${size}px`,
        '--border-radius': '50%',
      }}
    />
  );
}
