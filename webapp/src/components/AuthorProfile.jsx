import { hasProfileText, handle, safeUrl } from '../lib/ens';
import { useT } from '../lib/i18n';
import { Body, Meta } from './Text';

/**
 * What an author says about themselves, when they have said anything.
 *
 * The contract holds no profile and never will: it knows addresses and
 * nothing else, and every field it might have held would be a field someone
 * has to maintain. ENS already holds these records, on the same chain, under
 * a registry with no owner — so the profile is read from there and shown
 * here, and nothing is stored by this app at all.
 *
 * Every field is optional and the whole header disappears when the author
 * has filled in none of them, which is the common case.
 */
export default function AuthorProfile({ profile }) {
  const t = useT();
  if (!hasProfileText(profile)) return null;

  const url = safeUrl(profile.url);
  const twitter = handle(profile.twitter);
  const github = handle(profile.github);

  return (
    <section className="mb-8 max-w-2xl" data-author-profile="">
      {profile.description && <Body className="mb-2">{profile.description}</Body>}
      {(url || twitter || github) && (
        <Meta as="div" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {url && <ProfileLink href={url} label={t('profile.website')} text={displayUrl(url)} />}
          {twitter && (
            <ProfileLink
              href={`https://x.com/${encodeURIComponent(twitter)}`}
              label={t('profile.twitter')}
              text={`@${twitter}`}
            />
          )}
          {github && (
            <ProfileLink
              href={`https://github.com/${encodeURIComponent(github)}`}
              label={t('profile.github')}
              text={github}
            />
          )}
        </Meta>
      )}
    </section>
  );
}

/** Somewhere else on the web: a new tab, and no referrer or opener. */
function ProfileLink({ href, label, text }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={label}
      className="hover:text-accent transition-colors"
    >
      {text}
    </a>
  );
}

/** A URL as somebody would say it out loud: no scheme, no trailing slash. */
function displayUrl(href) {
  try {
    const u = new URL(href);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return href;
  }
}
