// GET /api/waitlist/admin[?format=csv|json], POST {unsubscribe:[...]} — HTTP Basic auth (any user, password =
// WAITLIST_ADMIN_PASSWORD), checked here, server-side. The list never ships in the publish dir.
import type { Config, Context } from "@netlify/functions";
import { clientIp, idFor, keyedHash, normalizeEmail, rateLimited, safeEqual, store, type Signup } from "../lib/waitlist.mts";

const nostore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const deny = () => new Response("Authentication required", {
  status: 401,
  headers: { ...nostore, "WWW-Authenticate": 'Basic realm="Tulum DAO waitlist", charset="UTF-8"' },
});

function password(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return null;
  try {
    const dec = atob(h.slice(6));
    return dec.slice(dec.indexOf(":") + 1);
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const csvCell = (s: string) => {
  // Neutralise spreadsheet formula injection, then quote.
  const v = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return `"${v.replace(/"/g, '""')}"`;
};

export default async (req: Request, ctx: Context) => {
  const want = process.env.WAITLIST_ADMIN_PASSWORD || "";
  if (want.length < 16) return new Response("Admin not configured", { status: 503, headers: nostore });
  const got = password(req);
  if (got === null) return deny();
  if (!safeEqual(got, want)) {
    if (await rateLimited("admin-" + (await keyedHash("admin:" + clientIp(req, ctx))), 10, 3600)) return new Response("Too many attempts", { status: 429, headers: nostore });
    return deny();
  }

  const s = store();
  // POST {"unsubscribe": [emails]} — used by the VPS sync to mirror unsubscribes made in Resend
  // (broadcast footer links) back into this list.
  if (req.method === "POST") {
    // JSON only: forces a CORS preflight, so a cross-site form can't ride cached Basic auth.
    if (!(req.headers.get("content-type") || "").startsWith("application/json")) {
      return new Response("JSON required", { status: 415, headers: nostore });
    }
    const b = (await req.json().catch(() => ({}))) as { unsubscribe?: unknown };
    const list = Array.isArray(b.unsubscribe) ? b.unsubscribe.slice(0, 500) : [];
    let changed = 0;
    for (const raw of list) {
      const email = normalizeEmail(raw);
      if (!email) continue;
      const id = await idFor(email);
      const rec = (await s.get(id, { type: "json" })) as Signup | null;
      if (rec && rec.status !== "unsubscribed") {
        rec.status = "unsubscribed";
        rec.unsubscribed_at = new Date().toISOString();
        await s.setJSON(id, rec);
        changed++;
      }
    }
    return new Response(JSON.stringify({ ok: true, changed }), { headers: { ...nostore, "Content-Type": "application/json" } });
  }
  const { blobs } = await s.list();
  const rows = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" }) as Promise<Signup | null>)))
    .filter((r): r is Signup => !!r)
    .sort((a, b) => b.ts.localeCompare(a.ts));
  const counts = { total: rows.length, pending: 0, confirmed: 0, unsubscribed: 0 };
  for (const r of rows) counts[r.status]++;

  const format = new URL(req.url).searchParams.get("format");
  if (format === "json") {
    return new Response(JSON.stringify({ counts, rows }), { headers: { ...nostore, "Content-Type": "application/json" } });
  }
  if (format === "csv") {
    const cols = ["email", "status", "source", "ts", "confirmed_at", "unsubscribed_at"] as const;
    const head = ["email", "status", "source", "signed_up_utc", "confirmed_utc", "unsubscribed_utc"];
    const lines = [head.join(","), ...rows.map((r) => cols.map((c) => csvCell(String(r[c] ?? ""))).join(","))];
    const day = new Date().toISOString().slice(0, 10);
    return new Response(lines.join("\r\n") + "\r\n", {
      headers: { ...nostore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tulumdao-waitlist-${day}.csv"` },
    });
  }

  // Shaw reads this page: Tulum time (America/Cancun, UTC-5, no DST). Storage and CSV stay UTC.
  const tulum = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cancun", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const tr = rows.map((r) => `<tr><td>${esc(r.email)}</td><td class="st ${r.status}">${r.status}</td><td>${esc(r.source)}</td><td>${esc(tulum.format(new Date(r.ts)).replace(",", ""))}</td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Waitlist admin</title>
<style>:root{--bg:#faf8f4;--fg:#1a1a1a;--mute:#666;--line:#e3ded4;--ok:#1d7a46;--warn:#9a6a00;--off:#999}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--mute:#999;--line:#2a2a2a;--ok:#5fcf8f;--warn:#e0b44a;--off:#777}}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px 16px;max-width:960px;margin-inline:auto}
.k{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.k div{border:1px solid var(--line);border-radius:8px;padding:12px 16px;min-width:110px}.k b{display:block;font-size:28px}
.k span{color:var(--mute);font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
th{color:var(--mute);font-weight:500}.st.confirmed{color:var(--ok)}.st.pending{color:var(--warn)}.st.unsubscribed{color:var(--off)}
.wrap{overflow-x:auto}a{color:inherit}</style></head><body>
<h1>Tulum DAO waitlist</h1>
<div class="k"><div><b>${counts.confirmed}</b><span>confirmed</span></div><div><b>${counts.pending}</b><span>pending</span></div><div><b>${counts.unsubscribed}</b><span>unsubscribed</span></div><div><b>${counts.total}</b><span>total</span></div></div>
<p><a href="?format=csv">Download CSV</a> (UTC) · times shown in Tulum time (UTC-5)</p>
<div class="wrap"><table><thead><tr><th>Email</th><th>Status</th><th>Source</th><th>Signed up (Tulum)</th></tr></thead><tbody>${tr || '<tr><td colspan="4">No signups yet.</td></tr>'}</tbody></table></div>
</body></html>`;
  return new Response(html, { headers: { ...nostore, "Content-Type": "text/html; charset=utf-8" } });
};

export const config: Config = { path: "/api/waitlist/admin", method: ["GET", "POST"] };
