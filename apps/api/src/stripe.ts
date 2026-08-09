/**
 * Minimal Stripe REST client.
 *
 * Talking to Stripe over plain fetch rather than pulling in the SDK: this uses
 * three endpoints, the wire format is form-encoded, and a dependency we cannot
 * exercise without live credentials is a dependency we cannot vouch for.
 *
 * The secret key comes from the environment, never from a tenant schema. A key
 * in a database column is a key in every backup and every screen share.
 */
const API = 'https://api.stripe.com/v1';

function secretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || undefined;
}

export function stripeConfigured(): boolean {
  return Boolean(secretKey());
}

async function call(
  path: string,
  init: { method?: string; body?: Record<string, string> } = {},
): Promise<{ ok: true; data: any } | { ok: false; error: string; status: number }> {
  const key = secretKey();
  if (!key) return { ok: false, error: 'Stripe is not configured on this server', status: 400 };

  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${key}`,
        ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: init.body ? new URLSearchParams(init.body).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data?.error?.message ?? `Stripe returned ${res.status}`,
      };
    }
    return { ok: true, data };
  } catch (err) {
    // Network failure, DNS, timeout. Say so plainly rather than surfacing a
    // stack trace to someone standing at a front desk.
    return {
      ok: false,
      status: 502,
      error: `Could not reach Stripe: ${(err as Error).message}`,
    };
  }
}

export interface StripeVerification {
  ok: boolean;
  error?: string;
  account?: { id: string; name: string | null; livemode: boolean };
  locations?: Array<{ id: string; label: string; readers: Array<{ id: string; label: string; status: string }> }>;
}

/**
 * Confirm the key works and report the Terminal locations and readers it can
 * see, so Settings can show what the facility actually has rather than asking
 * someone to paste an ID they would have to go and look up.
 */
export async function verifyStripe(): Promise<StripeVerification> {
  const account = await call('/account');
  if (!account.ok) return { ok: false, error: account.error };

  const locations = await call('/terminal/locations?limit=20');
  if (!locations.ok) return { ok: false, error: locations.error };

  const readers = await call('/terminal/readers?limit=100');
  const readerList: any[] = readers.ok ? (readers.data.data ?? []) : [];

  return {
    ok: true,
    account: {
      id: account.data.id,
      name: account.data.settings?.dashboard?.display_name ?? account.data.business_profile?.name ?? null,
      livemode: Boolean(account.data.livemode),
    },
    locations: (locations.data.data ?? []).map((l: any) => ({
      id: l.id,
      label: l.display_name ?? l.id,
      readers: readerList
        .filter((r) => r.location === l.id)
        .map((r) => ({ id: r.id, label: r.label ?? r.id, status: r.status })),
    })),
  };
}

/**
 * Charge a reader. Creates a PaymentIntent for card-present capture and hands
 * it to the reader, which is what actually prompts the customer to tap.
 */
export async function chargeTerminal(opts: {
  amountCents: number;
  currency: string;
  readerId: string;
  description: string;
  idempotencyKey: string;
}): Promise<{ ok: true; paymentIntentId: string } | { ok: false; error: string }> {
  const intent = await call('/payment_intents', {
    method: 'POST',
    body: {
      amount: String(opts.amountCents),
      currency: opts.currency.toLowerCase(),
      'payment_method_types[]': 'card_present',
      capture_method: 'automatic',
      description: opts.description,
    },
  });
  if (!intent.ok) return { ok: false, error: intent.error };

  const processed = await call(`/terminal/readers/${opts.readerId}/process_payment_intent`, {
    method: 'POST',
    body: { payment_intent: intent.data.id },
  });
  if (!processed.ok) return { ok: false, error: processed.error };

  return { ok: true, paymentIntentId: intent.data.id };
}
