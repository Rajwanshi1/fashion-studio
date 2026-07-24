export interface VcfCustomer {
  firstName: string;
  lastName: string;
  phone: string; // E.164
}

/** RFC 6350 text escaping: backslash first, then newline/comma/semicolon. */
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * vCard 3.0 export, one card per customer. Names are suffixed "— TA" so
 * boutique clients group together in the phone's contact list; nameless
 * phone-only accounts fall back to "TA Client <number>". CRLF line endings
 * per spec (iOS Contacts is strict about them).
 */
export function customersToVcf(rows: VcfCustomer[]): string {
  const cards = rows.map((r) => {
    const name = `${r.firstName} ${r.lastName}`.trim();
    const fn = name ? `${name} — TA` : `TA Client ${r.phone}`;
    return [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${esc(r.lastName)};${esc(r.firstName)};;;`,
      `FN:${esc(fn)}`,
      `TEL;TYPE=CELL:${r.phone}`,
      'END:VCARD',
    ].join('\r\n');
  });
  return cards.length ? cards.join('\r\n') + '\r\n' : '';
}
