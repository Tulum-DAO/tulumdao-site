// Shared waitlist helpers. Server-only: imported by netlify/functions/waitlist-*.mts.
// Store: Netlify Blobs ("waitlist"), one JSON record per email keyed by a hash of the
// address, so a key never reveals the address. Nothing here lands in the publish dir.
import { getStore } from "@netlify/blobs";

export type Status = "pending" | "confirmed" | "unsubscribed";
export interface Signup {
  email: string;
  source: string;
  ts: string; // first signup, ISO UTC
  status: Status;
  confirmed_at?: string;
  unsubscribed_at?: string;
  confirm_sent_at?: string;
  confirm_sends?: number;
}

export const SITE = process.env.WAITLIST_SITE_URL || "https://tulumdao.com";
const FROM = process.env.WAITLIST_FROM || "Tulum DAO <hello@tulumdao.com>";
const REPLY_TO = process.env.WAITLIST_REPLY_TO || "hello@tulumdao.com";

export const store = () => getStore({ name: "waitlist", consistency: "strong" });
const limits = () => getStore({ name: "waitlist-ratelimit", consistency: "strong" });

function secret(): string {
  const s = process.env.WAITLIST_HMAC_SECRET;
  if (!s || s.length < 32) throw new Error("WAITLIST_HMAC_SECRET missing or short");
  return s;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Keyed (HMAC) hash for IPs: without WAITLIST_HMAC_SECRET it cannot be brute-forced back to
// an address, which a plain sha256 over 2^32 IPv4 values can be in minutes.
export const keyedHash = async (s: string) => (await hmac("k:" + s)).slice(0, 32);

export const idFor = async (email: string) => (await sha256("wl:" + email)).slice(0, 32);
export const tokenFor = (id: string, purpose: "confirm" | "unsub") => hmac(purpose + ":" + id);
export async function checkToken(id: string, purpose: "confirm" | "unsub", t: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(t)) return false;
  return safeEqual(await tokenFor(id, purpose), t);
}

// Deliberately plain: one @, a dotted domain, no spaces, sane lengths. Deliverability is
// proven by double opt-in, not by a regex.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  const m = /^([a-z0-9._%+'-]{1,64})@([a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63})$/.exec(e);
  if (!m || m[1].startsWith(".") || m[1].endsWith(".") || m[1].includes("..")) return null;
  return e;
}

export function clientIp(req: Request, ctx: { ip?: string }): string {
  return ctx.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
}

// Fixed-window limit per keyed IP hash. One entry per IP, overwritten when the window
// rolls, because Blobs has no TTL. No atomic increment, so a burst can overshoot by a few;
// that is fine for a signup form.
export async function rateLimited(ipKey: string, max = 20, windowSec = 3600): Promise<boolean> {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const s = limits();
  const cur = (await s.get(ipKey, { type: "json" })) as { win: number; n: number } | null;
  const n = cur && cur.win === win ? cur.n : 0;
  if (n >= max) return true;
  await s.setJSON(ipKey, { win, n: n + 1 });
  return false;
}

export function links(id: string, confirmT: string | null, unsubT: string) {
  return {
    confirm: confirmT ? `${SITE}/api/waitlist/confirm?id=${id}&t=${confirmT}` : null,
    unsub: `${SITE}/api/waitlist/unsubscribe?id=${id}&t=${unsubT}`,
    privacy: `${SITE}/privacy/`,
  };
}

export async function sendConfirm(email: string, id: string): Promise<{ ok: boolean; status: number }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 0 };
  const l = links(id, await tokenFor(id, "confirm"), await tokenFor(id, "unsub"));
  const text = [
    "Someone (hopefully you) asked to join the Tulum DAO waitlist with this address.",
    "",
    "Confirm here:",
    l.confirm,
    "",
    "If that wasn't you, ignore this email and nothing happens.",
    "",
    "Tulum DAO, Tulum, Mexico",
    `Privacy: ${l.privacy}`,
    `Unsubscribe: ${l.unsub}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
<p>Someone (hopefully you) asked to join the <strong>Tulum DAO</strong> waitlist with this address.</p>
<p><a href="${l.confirm}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Confirm my spot</a></p>
<p style="font-size:14px;color:#555">If that wasn't you, ignore this email and nothing happens.</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:12px;color:#777">Tulum DAO, Tulum, Mexico &middot; <a href="${l.privacy}" style="color:#777">Privacy</a> &middot; <a href="${l.unsub}" style="color:#777">Unsubscribe</a></p>
</body></html>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `confirm-${id}-${new Date().toISOString().slice(0, 13)}` },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      reply_to: REPLY_TO,
      subject: "Confirm your spot on the Tulum DAO waitlist",
      text,
      html,
      headers: { "List-Unsubscribe": `<${l.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "kind", value: "waitlist_confirm" }],
    }),
  });
  return { ok: r.ok, status: r.status };
}

// A one-button page for links that act. Mail scanners (Safe Links, Proofpoint, Mimecast)
// fetch every GET in a message, so a GET only renders this; the button's POST acts.
export function buttonPage(title: string, h1: string, p: string, action: string, button: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Tulum DAO</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#1a1a1a;background:#faf8f4}button{font:inherit;background:#1a1a1a;color:#fff;border:0;border-radius:6px;padding:12px 20px;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}button{background:#eee;color:#111}}</style></head>
<body><h1>${h1}</h1><p>${p}</p>
<form method="post" action="${action}"><button type="submit">${button}</button></form></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export function wantsJson(req: Request): boolean {
  return (req.headers.get("accept") || "").includes("application/json");
}

export function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
