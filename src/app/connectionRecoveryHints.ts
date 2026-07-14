export type RecoveryErrorPresentation = {
  label: string;
  detail: string;
  recoveryHint: string;
  showNewWorldAction: boolean;
};

function isDevEnvironment(): boolean {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return true;
  }
  return import.meta.env?.DEV === true;
}

function devServerHint(): string {
  if (!isDevEnvironment()) return '';
  return ' Developers: redeploy with `npm run deploy:local`, or wipe the database with `npm run deploy:local-clean`.';
}

function stuckHint(includeNewWorld: boolean): string {
  const steps = [
    'If retry does not help, clear this site\'s stored data in your browser (local storage) and reload the page.',
  ];
  if (includeNewWorld) {
    steps.push('You can also start a new world to reset your settlement on the server.');
  }
  return steps.join(' ');
}

export function formatBootstrapFailure(error: unknown): RecoveryErrorPresentation {
  const message = error instanceof Error ? error.message : 'World bootstrap failed.';
  const lower = message.toLowerCase();

  if (message.includes('Cannot change world generation')) {
    return {
      label: 'World bootstrap failed',
      detail: message,
      recoveryHint: `Your browser saved map settings (for example Small) do not match the server database, which was not fully reset. Use Start new world below, or clear this site's local storage and reload.${devServerHint()} ${stuckHint(false)}`,
      showNewWorldAction: true,
    };
  }

  if (lower.includes('timed out waiting for world_config')) {
    return {
      label: 'World bootstrap failed',
      detail: message,
      recoveryHint: `The server never published world configuration. Ensure SpacetimeDB is running and the game module is deployed.${devServerHint()} Then retry.`,
      showNewWorldAction: false,
    };
  }

  return {
    label: 'World bootstrap failed',
    detail: message,
    recoveryHint: `${stuckHint(true)}${devServerHint()}`,
    showNewWorldAction: true,
  };
}

export function formatWorldGenerationMismatch(message: string): RecoveryErrorPresentation {
  return {
    label: 'World settings mismatch',
    detail: message,
    recoveryHint: `Re-picking map size in the setup panel cannot fix a server that is already running. Use Start new world below to reset the server settlement.${devServerHint()} ${stuckHint(false)}`,
    showNewWorldAction: true,
  };
}

export function formatConnectionUnavailable(): RecoveryErrorPresentation {
  return {
    label: 'SpacetimeDB unavailable',
    detail: 'Could not connect to the game server.',
    recoveryHint: isDevEnvironment()
      ? 'Run `spacetime start` and `npm run deploy:local`, then retry.'
      : 'Check your network connection and retry. If the problem continues, try again later or clear this site\'s stored data and reload.',
    showNewWorldAction: false,
  };
}
