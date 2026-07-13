// Outbound notification transport (BUILD SPEC §9). Dormant-safe: every sender
// no-ops with a reason when its credentials aren't set, so the app runs fine
// before Twilio/VAPID are keyed.
import webpush from 'web-push';

export interface SendResult {
  sent: boolean;
  reason?: string;
}

let vapidReady = false;
function configureVapid(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:board@emeraldbay.example';
  if (!pub || !priv) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  }
  return true;
}

/** SMS via the Twilio REST API (no SDK dependency). */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { sent: false, reason: 'twilio-unconfigured' };
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      },
    );
    if (!res.ok) return { sent: false, reason: `twilio-${res.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: 'twilio-error' };
  }
}

/** Web push to one device subscription. */
export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: object,
): Promise<SendResult> {
  if (!configureVapid()) return { sent: false, reason: 'vapid-unconfigured' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { sent: true };
  } catch {
    return { sent: false, reason: 'push-failed' };
  }
}
