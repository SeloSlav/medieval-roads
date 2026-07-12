export type LoadingProgress = {
  label: string;
  detail?: string;
};

const LOADING_ROOT_ID = 'app-loading';

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly spinnerEl: HTMLElement | null;
  private readonly retryButton: HTMLButtonElement;
  private dismissed = false;
  private retryHandler: (() => void) | null = null;

  constructor() {
    const root = document.getElementById(LOADING_ROOT_ID);
    if (!root) {
      throw new Error(`Missing #${LOADING_ROOT_ID} element.`);
    }

    const labelEl = root.querySelector<HTMLElement>('[data-loading-label]');
    const detailEl = root.querySelector<HTMLElement>('[data-loading-detail]');
    const retryButton = root.querySelector<HTMLButtonElement>('[data-loading-retry]');
    if (!labelEl || !detailEl || !retryButton) {
      throw new Error('Loading screen markup is missing label, detail, or retry elements.');
    }

    this.root = root;
    this.labelEl = labelEl;
    this.detailEl = detailEl;
    this.spinnerEl = root.querySelector<HTMLElement>('.app-loading-spinner');
    this.retryButton = retryButton;
    this.retryButton.addEventListener('click', () => {
      this.retryHandler?.();
    });
  }

  static tryCreate(): LoadingScreen | null {
    if (!document.getElementById(LOADING_ROOT_ID)) return null;
    return new LoadingScreen();
  }

  setProgress(progress: LoadingProgress): void {
    if (this.dismissed) return;
    this.clearErrorState();
    this.labelEl.textContent = progress.label;
    this.detailEl.textContent = progress.detail ?? '';
  }

  setErrorState(progress: LoadingProgress, onRetry: () => void): void {
    if (this.dismissed) return;
    this.labelEl.textContent = progress.label;
    this.detailEl.textContent = progress.detail ?? '';
    this.retryHandler = onRetry;
    this.spinnerEl?.classList.add('is-hidden');
    this.retryButton.hidden = false;
    this.root.setAttribute('aria-busy', 'false');
  }

  clearErrorState(): void {
    this.retryHandler = null;
    this.spinnerEl?.classList.remove('is-hidden');
    this.retryButton.hidden = true;
    this.root.setAttribute('aria-busy', 'true');
  }

  dismiss(): void {
    if (this.dismissed || this.retryHandler !== null) return;
    this.dismissed = true;
    this.root.classList.add('is-dismissed');
    window.setTimeout(() => {
      this.root.remove();
    }, 420);
  }
}
