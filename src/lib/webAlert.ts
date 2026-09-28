/**
 * @fileoverview src/lib/webAlert.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export interface WebAlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface WebDialogHost {
  alert(message?: string): void;
  confirm(message?: string): boolean;
  prompt(message?: string): string | null;
}

const alertText = (title: string, message?: string) => [title.trim(), message?.trim()].filter(Boolean).join('\n\n');

export const showWebAlert = (host: WebDialogHost, title: string, message?: string, buttons?: WebAlertButton[]): void => {
  const text = alertText(title, message);
  const configuredButtons = buttons?.length ? buttons : undefined;
  if (!configuredButtons) {
    host.alert(text);
    return;
  }

  const cancelButton = configuredButtons.find(button => button.style === 'cancel');
  const actionButtons = configuredButtons.filter(button => button !== cancelButton);
  if (actionButtons.length === 0) {
    host.alert(text);
    cancelButton?.onPress?.();
    return;
  }
  if (actionButtons.length === 1) {
    const action = actionButtons[0];
    if (cancelButton) {
      const confirmed = host.confirm(`${text}\n\n${action.text || 'Continue'}?`);
      if (confirmed) action.onPress?.();
      else cancelButton.onPress?.();
    } else {
      host.alert(text);
      action.onPress?.();
    }
    return;
  }

  // No current app flow has multiple non-cancel choices, but preserve a
  // deterministic fallback instead of silently choosing one if one is added.
  const promptText = `${text}\n\n${actionButtons.map((button, index) => `${index + 1}. ${button.text || `Option ${index + 1}`}`).join('\n')}`;
  const selection = host.prompt(promptText);
  if (selection === null) {
    cancelButton?.onPress?.();
    return;
  }
  const selectedIndex = Number.parseInt(selection, 10) - 1;
  const action = actionButtons[selectedIndex];
  if (!action) {
    host.alert('No action was taken because the selected option was invalid.');
    cancelButton?.onPress?.();
    return;
  }
  action.onPress?.();
};
