/** Sites supplies its own private access gate before requests reach the app. */
export function authorizeRequest(headers: Headers): Response | null {
  void headers;
  return null;
}
