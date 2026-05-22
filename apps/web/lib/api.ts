import type { ContentDetail, ContentSummary } from "@aicp/shared";
import { mockContents, mockDetail } from "./mock-data";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getContents(): Promise<ContentSummary[]> {
  try {
    return await apiGet<ContentSummary[]>("/contents");
  } catch {
    return mockContents;
  }
}

export async function getRankings(): Promise<ContentSummary[]> {
  try {
    const response = await apiGet<{ items: ContentSummary[] }>("/rankings?type=hot&limit=20");
    return response.items;
  } catch {
    return mockContents;
  }
}

export async function getContentDetail(id: string): Promise<ContentDetail> {
  try {
    return await apiGet<ContentDetail>(`/contents/${id}`);
  } catch {
    return {
      ...mockDetail,
      id
    };
  }
}

export { API_BASE_URL };
