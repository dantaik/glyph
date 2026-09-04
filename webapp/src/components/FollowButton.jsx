import { follow, unfollow, useFollowing } from '../lib/following';
import { useT } from '../lib/i18n';
import { SEGMENT_OFF, SEGMENT_ON } from './formStyles';

/**
 * Follow an author, or stop.
 *
 * The list is kept in this browser and nowhere else: following somebody is a
 * decision about what you read, not a fact about them, so it costs no gas and
 * tells them nothing.
 */
export default function FollowButton({ author, compact = false, className = '' }) {
  const t = useT();
  const following = useFollowing();
  const on = following.includes(String(author ?? '').toLowerCase());
  // In a byline the pill sits inside a line of running text, so it loses its
  // padding and keeps only the word.
  const base = compact ? `${on ? SEGMENT_ON : SEGMENT_OFF} px-0 py-0 bg-transparent` : on ? SEGMENT_ON : SEGMENT_OFF;

  return (
    <button
      type="button"
      onClick={() => (on ? unfollow(author) : follow(author))}
      aria-pressed={on}
      title={on ? t('following.unfollowTitle') : t('following.followTitle')}
      className={`${base} ${className}`}
      data-follow-button=""
    >
      {on ? t('following.following') : t('following.follow')}
    </button>
  );
}
