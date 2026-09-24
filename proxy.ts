import { NextResponse } from "next/server";
import { checkAccess, isPublicPath, LOGIN_PATH } from "@/lib/server/access";

export async function proxy(request: Request) {
  const url = new URL(request.url);
  if (isPublicPath(url.pathname)) return NextResponse.next();

  const access = await checkAccess(request.headers);
  if (access === "ok") return NextResponse.next();

  if (access === "unconfigured") {
    return NextResponse.json(
      { error: "El acceso al almacén todavía no está configurado." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // The app fetches its own API, so answer it in JSON instead of redirecting a
  // fetch() into an HTML page it cannot read.
  if (url.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Tu sesión ha caducado. Vuelve a entrar." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // The app is a single page, so there is nowhere else to send anyone back to.
  return NextResponse.redirect(new URL(LOGIN_PATH, url));
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image(?:/|$)|favicon\\.(?:ico|svg)$).*)"],
};
