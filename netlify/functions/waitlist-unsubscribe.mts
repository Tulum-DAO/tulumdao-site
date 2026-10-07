// /api/waitlist/unsubscribe?id=&t=
//   GET  -> a one-button page (mail scanners prefetch GETs; a GET must not unsubscribe).
//   POST -> unsubscribes. Also serves RFC 8058 one-click (List-Unsubscribe-Post).
import type { Config } from "@netlify/functions";
import { checkToken, redirect, store, type Signup } from "../lib/waitlist.mts";

const page = (action: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe · Tulum DAO</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#1a1a1a;background:#faf8f4}button{font:inherit;background:#1a1a1a;color:#fff;border:0;border-radius:6px;padding:12px 20px;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}button{background:#eee;color:#111}}</style></head>
<body><h1>Leave the Tulum DAO waitlist?</h1><p>You won't get any more emails from us.</p>
<form method="post" action="${action}"><button type="submit">Unsubscribe</button></form></body></html>`;

export default async (req: Request) => {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || "";
  const t = u.searchParams.get("t") || "";
  if (!(await checkToken(id, "unsub", t))) return redirect("/waitlist/error/?e=bad_link");
  if (req.method === "GET") {
    return new Response(page(`/api/waitlist/unsubscribe?id=${id}&t=${t}`), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
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
