import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server/access";

export function proxy(request: Request) {
  return authorizeRequest(request.headers) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image(?:/|$)|favicon\\.(?:ico|svg)$).*)"],
};
