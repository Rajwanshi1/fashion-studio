/**
 * Masked SMS seam, mirroring PaymentProvider: null means phone-OTP login is
 * not configured and the endpoints answer 503.
 */
export interface SmsProvider {
  /** Delivers an OTP code to an E.164 phone. Throws on delivery failure. */
  sendOtp(phone: string, code: string): Promise<void>;
}

/** Dev/staging provider: prints the code instead of sending it. */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[otp] code for ${phone}: ${code}`);
  }
}

/**
 * MSG91 OTP delivery. We generate and verify codes ourselves; MSG91 only
 * carries the message, so a provider switch never touches the login flow.
 * The DLT-approved template referenced by templateId must contain an ##OTP## var.
 */
export class Msg91SmsProvider implements SmsProvider {
  constructor(
    private authKey: string,
    private templateId: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', this.templateId);
    url.searchParams.set('mobile', phone.replace(/^\+/, ''));
    url.searchParams.set('otp', code);
    const res = await this.fetchFn(url, { method: 'POST', headers: { authkey: this.authKey } });
    if (!res.ok) throw new Error(`MSG91 send failed: HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { type?: string; message?: string } | null;
    if (body?.type === 'error') throw new Error(`MSG91 send failed: ${body.message ?? 'unknown error'}`);
  }
}
