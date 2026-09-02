import { Component } from 'react';

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
            <h1 className="text-lg text-ink-soft">页面出错了</h1>
            <p className="mt-2 break-all text-sm leading-relaxed text-ink-faint">
              {String(this.state.error?.message || this.state.error)}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-full border border-edge-strong px-5 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
