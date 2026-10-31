import webpush from "web-push";
import { adminClient } from "./supabase/admin";

export type PushPayload = { title: string; body: string; url: string; tag?: string };
/** devices: for each person, how many of their phones the message was handed to. configured: false when the notification keys are not set up. */
export type PushResult = { configured: boolean; devices: Record<string, number> };

let ready = false;
function configure(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!ready) { webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:info@cipcogroup.com", pub, priv); ready = true; }
  return true;
}

/** Send one notification to every phone these people have switched on. A phone that has gone (uninstalled, permission removed) is forgotten. */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<PushResult> {
  const devices: Record<string, number> = {}; userIds.forEach((u) => { devices[u] = 0; });
  if (!userIds.length) return { configured: true, devices };
  if (!configure()) return { configured: false, devices };
  const db = adminClient();
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", userIds);
  const body = JSON.stringify(payload);
  await Promise.all(((subs || []) as any[]).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: "high" });
      devices[s.user_id] = (devices[s.user_id] || 0) + 1;
      await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else await db.from("push_subscriptions").update({ fail_count: (s.fail_count || 0) + 1 }).eq("id", s.id);
    }
  }));
  return { configured: true, devices };
}
