import { hrefFor } from '../lib/router';
import AddressLabel from './Address';

/**
 * The author in a list's meta line: identicon + address tail, linking to
 * the author's page. The featured card and the article rows share it, so
 * the first entry of a list names its author the same way as the rest.
 */
export default function AuthorLink({ author, navigate }) {
  return (
    <a
      href={hrefFor({ author })}
      onClick={(e) => {
        e.preventDefault();
        navigate({ author });
      }}
      title={author}
      className="inline-flex items-center text-ink-faint hover:text-accent transition-colors"
    >
      <AddressLabel address={author} size={14} tailClassName="text-2xs" />
    </a>
  );
}
