const SESSION_KEY = "fmt-diss-session-id";

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY);
}

export function setSessionId(id: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, id);
}
