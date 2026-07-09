import { getToastMessage, type ToastMessageId } from './toastMessages.ts';

export type ToastVariant = 'error' | 'info' | 'success';

export type ToastOptions = {
  variant?: ToastVariant;
  durationMs?: number;
  dismissOnClick?: boolean;
};

const DEFAULT_DURATION_MS = 4500;
const DISMISS_ANIMATION_MS = 280;

export class ToastManager {
  private readonly container: HTMLElement;
  private activeToast: HTMLElement | null = null;
  private dismissTimer = 0;
  private dismissAnimationTimer = 0;

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-atomic', 'true');
    root.appendChild(this.container);
  }

  show(message: string, options: ToastOptions = {}): void {
    this.clearTimers();
    this.removeActiveToast();

    const variant = options.variant ?? 'error';
    const dismissOnClick = options.dismissOnClick ?? true;
    const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;

    const toast = document.createElement('div');
    toast.className = `toast toast--${variant}`;
    toast.textContent = message;
    toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    if (dismissOnClick) {
      toast.classList.add('toast--clickable');
      toast.tabIndex = 0;
      toast.setAttribute('aria-label', `${message}. Click to dismiss.`);
    }

    const dismiss = () => this.dismiss();
    if (dismissOnClick) {
      toast.addEventListener('click', dismiss);
      toast.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          dismiss();
        }
      });
    }

    this.container.appendChild(toast);
    this.activeToast = toast;
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    if (durationMs > 0) {
      this.dismissTimer = window.setTimeout(() => this.dismiss(), durationMs);
    }
  }

  showMessageId(id: ToastMessageId, options: ToastOptions = {}): void {
    this.show(getToastMessage(id), options);
  }

  dismiss(): void {
    if (!this.activeToast) return;
    this.clearTimers();

    const toast = this.activeToast;
    toast.classList.remove('is-visible');
    toast.classList.add('is-dismissing');

    this.dismissAnimationTimer = window.setTimeout(() => {
      toast.remove();
      if (this.activeToast === toast) this.activeToast = null;
    }, DISMISS_ANIMATION_MS);
  }

  dispose(): void {
    this.clearTimers();
    this.removeActiveToast();
    this.container.remove();
  }

  private clearTimers(): void {
    if (this.dismissTimer) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = 0;
    }
    if (this.dismissAnimationTimer) {
      window.clearTimeout(this.dismissAnimationTimer);
      this.dismissAnimationTimer = 0;
    }
  }

  private removeActiveToast(): void {
    if (!this.activeToast) return;
    this.activeToast.remove();
    this.activeToast = null;
  }
}
