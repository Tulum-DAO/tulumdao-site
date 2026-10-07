// GET /api/waitlist/confirm?id=&t= — the link in the opt-in email.
import type { Config } from "@netlify/functions";
import { checkToken, redirect, store, type Signup } from "../lib/waitlist.mts";

export default async (req: Request) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || "";
  const t = u.searchParams.get("t") || "";
  if (!(await checkToken(id, "confirm", t))) return redirect("/waitlist/error/?e=bad_link");
  const s = store();
  const rec = (await s.get(id, { type: "json" })) as Signup | null;
  if (!rec) return redirect("/waitlist/error/?e=bad_link");
  // An unsubscribed person re-confirming from an old mail is a fresh, explicit opt-in.
  if (rec.status !== "confirmed") {
    rec.status = "confirmed";
    rec.confirmed_at = new Date().toISOString();
    delete rec.unsubscribed_at;
    await s.setJSON(id, rec);
  }
  return redirect("/waitlist/confirmed/");
};

export const config: Config = { path: "/api/waitlist/confirm", method: ["GET"] };
