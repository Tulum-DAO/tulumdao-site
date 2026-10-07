// POST /api/waitlist/signup — form or JSON {email, source?, website?(honeypot)}.
// Responds the same way whether the address is new, pending or already confirmed, so the
// endpoint cannot be used to test who is on the list.
import type { Config, Context } from "@netlify/functions";
import { clientIp, idFor, json, normalizeEmail, rateLimited, redirect, sendConfirm, sha256, store, wantsJson, type Signup } from "../lib/waitlist.mts";

const RESEND_GAP_MS = 10 * 60 * 1000;
const MAX_CONFIRM_SENDS = 3;

async function readBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const b = await req.json().catch(() => ({}));
    return typeof b === "object" && b ? (b as Record<string, string>) : {};
  }
  const f = await req.formData().catch(() => null);
  const out: Record<string, string> = {};
  f?.forEach((v, k) => { if (typeof v === "string") out[k] = v; });
  return out;
}

export default async (req: Request, ctx: Context) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const asJson = wantsJson(req);
  const done = () => (asJson ? json({ ok: true }) : redirect("/waitlist/check-email/"));
  const fail = (error: string, status: number) => (asJson ? json({ ok: false, error }, status) : redirect(`/waitlist/error/?e=${error}`));

  const body = await readBody(req);
  // Honeypot: humans never see or fill "website". Pretend success so bots learn nothing.
  if ((body.website || "").trim() !== "") return done();

  const email = normalizeEmail(body.email);
  if (!email) return fail("invalid_email", 400);

  const ipHash = (await sha256("ip:" + clientIp(req, ctx))).slice(0, 24);
  if (await rateLimited(ipHash)) return fail("rate_limited", 429);

  const source = (body.source || "site").replace(/[^a-z0-9_\-:/.]/gi, "").slice(0, 64) || "site";
  const id = await idFor(email);
  const s = store();
  const now = new Date();
  const prev = (await s.get(id, { type: "json" })) as Signup | null;

  if (prev?.status === "confirmed") return done();

  const rec: Signup = prev
    ? { ...prev, status: "pending" }
    : { email, source, ts: now.toISOString(), status: "pending", ip_hash: ipHash, confirm_sends: 0 };

  const last = rec.confirm_sent_at ? Date.parse(rec.confirm_sent_at) : 0;
  const mayResend = (rec.confirm_sends ?? 0) < MAX_CONFIRM_SENDS && now.getTime() - last > RESEND_GAP_MS;
  if (mayResend) {
    const r = await sendConfirm(email, id);
    if (r.ok) {
      rec.confirm_sent_at = now.toISOString();
      rec.confirm_sends = (rec.confirm_sends ?? 0) + 1;
    } else {
      console.error(`waitlist confirm send failed status=${r.status} id=${id}`);
    }
  }
  await s.setJSON(id, rec);
  return done();
};

export const config: Config = { path: "/api/waitlist/signup", method: ["POST"] };
