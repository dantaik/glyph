import { unfollow, useFollowing } from '../lib/following';
import { useT } from '../lib/i18n';
import { hrefFor } from '../lib/router';
import AuthorName from './AuthorName';
import { Trash } from './Icons';
import SectionHeader from './SectionHeader';
import { Body, Note } from './Text';
import { ICON_BTN } from './formStyles';

/**
 * The followed authors, on the settings page: somewhere to see the whole
 * list and prune it, since the follow button itself lives on each author's
 * page and a list you can only add to is a trap.
 */
export default function FollowingSection({ navigate }) {
  const t = useT();
  const following = useFollowing();

  return (
    <section className="mb-10" data-following-section="">
      <SectionHeader label={t('following.settingsHeading')} />
      <Note className="mb-3 max-w-2xl">{t('following.settingsNote')}</Note>

      {following.length === 0 ? (
        <Body>{t('following.none')}</Body>
      ) : (
        <ul className="divide-y divide-edge border-y border-edge">
          {following.map((address) => (
            <li key={address} className="flex items-center gap-2 py-2">
              <a
                href={hrefFor({ author: address })}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ author: address });
                }}
                title={address}
                className="inline-flex min-w-0 flex-1 items-center text-ink-soft hover:text-accent transition-colors"
              >
                <AuthorName address={address} />
              </a>
              <button
                type="button"
                onClick={() => unfollow(address)}
                aria-label={t('following.remove', { address })}
                className={ICON_BTN}
              >
                <Trash size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
