export const API_BASE = import.meta.env.VITE_API_BASE;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export type EmailStatus = "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED";

export type CampaignEmail = {
  id: string;
  recipientEmail: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  error: string | null;
};

export type Campaign = {
  id: string;
  subject: string;
  body: string;
  startAt: string;
  minimumDelayMs: number;
  hourlyLimit: number;
  createdAt: string;
  emails: CampaignEmail[];
};

export type SearchEmail = {
  id: string;
  emailId: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
};

export type EmailDetail = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  campaign: {
    id: string;
    name: string;
    startAt: string;
    createdAt: string;
  };
};

type ApiOptions = Omit<RequestInit, "credentials">;

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Could not connect to ReachInbox. Check that the backend is running on port 5001.");
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Use the HTTP status when a server response has no JSON body.
    }
    if (response.status === 401) message = "Your session has expired. Please sign in again.";
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<{ authenticated: boolean; user: SessionUser | null }>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, name?: string) =>
    request<{ user: SessionUser }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  campaigns: () => request<Campaign[]>("/api/campaigns"),
  email: (id: string) => request<EmailDetail>(`/api/emails/${encodeURIComponent(id)}`),
  searchEmails: (query: string) =>
    request<{ results: SearchEmail[] }>(`/api/search/emails?q=${encodeURIComponent(query)}`),
  createCampaign: (payload: {
    subject: string;
    body: string;
    recipients: string[];
    startTime: string;
    delayBetweenEmails: number;
    hourlyLimit: number;
  }) => request<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(payload) }),
};
