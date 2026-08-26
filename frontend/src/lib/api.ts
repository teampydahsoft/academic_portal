export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

/**
 * Browser/API fetch that always sends the HTTP-only session cookie.
 * Do not put tokens in localStorage.
 */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  return fetch(url, {
    ...init,
    credentials: "include",
    cache: init.cache ?? "no-store",
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
