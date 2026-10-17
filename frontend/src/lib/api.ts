export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

export async function requestJson(path: string, options: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string") headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") {
    const token = await authorization();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    signal: options.signal ?? AbortSignal.timeout(60000),
    headers,
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null && "detail" in data && typeof data.detail === "string"
      ? data.detail : `Request failed (${response.status}).`;
    throw new Error(detail);
  }
  return data;
}
import { authorization } from "./auth-client";
