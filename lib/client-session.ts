'use client';

/** Drop all in-memory data and the client router cache when the identity ends. */
export function returnToLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/login');
}
