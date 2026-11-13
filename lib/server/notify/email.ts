/** Email via the Resend REST API (https://resend.com/docs/api-reference/emails/send-email). */
import "../guard";
import { redact, isRetryableStatus, type ChannelResult, type FetchLike } from "./types";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL);
}

export async function sendEmail(
  to: string | null,
  msg: { subject: string; text: string },
  fetchImpl: FetchLike = fetch,
): Promise<ChannelResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from) return { status: "skipped", reason: "email not configured on server (RESEND_API_KEY / ALERT_FROM_EMAIL unset)" };
  if (!to) return { status: "skipped", reason: "no email address in user settings" };
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      return { status: "failed", error: redact(`resend ${res.status}: ${body.message ?? body.name ?? res.statusText}`), retryable: isRetryableStatus(res.status) };
    }
    return { status: "sent", providerId: body.id ?? null };
  } catch (e) {
    return { status: "failed", error: redact(`resend network error: ${e instanceof Error ? e.message : String(e)}`), retryable: true };
  }
}
