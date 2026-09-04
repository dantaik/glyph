import { Component } from 'react';
import { t } from '../lib/i18n';
import { BTN_OUTLINE_PILL } from './formStyles';
import { Body, Title } from './Text';

/**
 * Last-resort boundary: the app decodes untrusted on-chain bytes (brotli,
 * markdown, images), so a render/effect error must never blank the whole
 * page. Shows the error and a reload button instead.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Glyph crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-6">
          <div className="max-w-sm py-20 text-center">
            <Title as="h1">{t('boundary.title')}</Title>
            <Body className="mt-2 break-all leading-relaxed">
              {String(this.state.error?.message || this.state.error)}
            </Body>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`mt-6 ${BTN_OUTLINE_PILL}`}
            >
              {t('boundary.reload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
