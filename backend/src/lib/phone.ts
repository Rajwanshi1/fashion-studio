/**
 * Normalizes a raw phone string to E.164. Accepts international "+…" input for
 * any country; bare numbers are assumed Indian mobiles (10 digits starting
 * 6-9, optionally 0- or 91-prefixed) because OTP and WhatsApp both require a
 * mobile number. Returns null when the input can't be a deliverable number.
 */
export function normalizePhone(raw: string, defaultCountryCode = '+91'): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (trimmed.startsWith('+')) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  const cc = defaultCountryCode.replace(/[^0-9]/g, '');
  let local = digits;
  if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
  if (local.length === 10 + cc.length && local.startsWith(cc)) local = local.slice(cc.length);
  if (local.length !== 10 || !/^[6-9]/.test(local)) return null;
  return `+${cc}${local}`;
}
