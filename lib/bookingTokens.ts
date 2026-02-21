import crypto from "node:crypto";

export function sha256Base64Url(input: string) {
  const hash = crypto.createHash("sha256").update(input).digest("base64");
  return hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function htmlPage(title: string, body: string) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
</head>
<body style="font-family:ui-sans-serif,system-ui,Arial; padding:24px;">
<h2>${title}</h2>
<div>${body}</div>
</body>
</html>`;
}
