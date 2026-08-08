/** Per-field validation errors, keyed by the field's input element id. */
export type FieldErrors = Record<string, string>;

/** One-line summary for the sticky bar: the message itself, or a count. */
export function errorSummary(errors: FieldErrors): string | null {
  const messages = Object.values(errors);
  if (messages.length === 0) return null;
  return messages.length === 1 ? messages[0] : `${messages.length} fields need attention`;
}

/** Scroll the first errored field into view and focus it. Keys must be element ids. */
export function scrollToFirstError(errors: FieldErrors) {
  const id = Object.keys(errors)[0];
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.focus?.({ preventScroll: true });
}
