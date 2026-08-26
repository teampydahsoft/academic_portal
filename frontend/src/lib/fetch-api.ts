import { cookies } from "next/headers";
import { API_BASE_URL } from "@/lib/api";

/**
 * Server-side API helper. Forwards the AP session cookie from the incoming
 * Next.js request so RSC pages stay authenticated.
 */
export async function fetchApi<T>(path: string): Promise<T> {
  const headers: HeadersInit = {};
  try {
    const jar = await cookies();
    const cookieHeader = jar
      .getAll()
      .map((item) => `${item.name}=${item.value}`)
      .join("; ");
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
  } catch {
    // Not in a Next.js request context
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: string }).message)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
