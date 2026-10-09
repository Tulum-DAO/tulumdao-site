// /api/waitlist/unsubscribe?id=&t=
//   GET  -> a one-button page (mail scanners prefetch GETs; a GET must not unsubscribe).
//   POST -> unsubscribes. Also serves RFC 8058 one-click (List-Unsubscribe-Post).
import type { Config } from "@netlify/functions";
import { buttonPage, checkToken, redirect, store, type Signup } from "../lib/waitlist.mts";

export default async (req: Request) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || "";
  const t = u.searchParams.get("t") || "";
  if (!(await checkToken(id, "unsub", t))) return redirect("/waitlist/error/?e=bad_link");
  if (req.method === "GET") {
    return buttonPage("Unsubscribe", "Leave the Tulum DAO waitlist?", "You won't get any more emails from us.",
      `/api/waitlist/unsubscribe?id=${id}&t=${t}`, "Unsubscribe");
  }
  const s = store();
  const rec = (await s.get(id, { type: "json" })) as Signup | null;
  if (rec && rec.status !== "unsubscribed") {
    rec.status = "unsubscribed";
    rec.unsubscribed_at = new Date().toISOString();
    await s.setJSON(id, rec);
  }
  return redirect("/waitlist/unsubscribed/");
};

export const config: Config = { path: "/api/waitlist/unsubscribe", method: ["GET", "POST"] };
