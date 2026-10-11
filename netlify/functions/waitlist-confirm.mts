// /api/waitlist/confirm?id=&t= — the link in the opt-in email.
//   GET  -> a one-button page. Mail scanners prefetch every link, so a GET that confirmed
//           would opt people in with no human click and defeat double opt-in.
//   POST -> confirms.
import type { Config } from "@netlify/functions";
import { buttonPage, checkToken, redirect, store, type Signup } from "../lib/waitlist.mts";

export default async (req: Request) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || "";
  const t = u.searchParams.get("t") || "";
  if (!(await checkToken(id, "confirm", t))) return redirect("/waitlist/error/?e=bad_link");
  if (req.method === "GET") {
    return buttonPage("Confirm", "Confirm your spot", "One click and you're on the Tulum DAO waitlist.",
      `/api/waitlist/confirm?id=${id}&t=${t}`, "Confirm my spot");
  }
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

export const config: Config = { path: "/api/waitlist/confirm", method: ["GET", "POST"] };
