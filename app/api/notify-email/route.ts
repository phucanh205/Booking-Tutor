import { NextResponse, type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const url = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
    const token = process.env.APPS_SCRIPT_EMAIL_TOKEN;

    if (!url || !token) {
      return NextResponse.json(
        { ok: false, error: "missing_apps_script_env" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as { to?: string; subject?: string; html?: string };
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const html = typeof body?.html === "string" ? body.html.trim() : "";

    if (!to || !subject || !html) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const webhook = `${url}?token=${encodeURIComponent(token)}`;

    const r = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, subject, html }),
    });

    const text = await r.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // ignore
    }

    if (!r.ok || parsed?.ok === false) {
      return NextResponse.json(
        { ok: false, error: "apps_script_failed", status: r.status, body: parsed ?? text },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
