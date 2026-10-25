import type { ProjectData, ProjectRecord, ProjectSummary } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  list: () => request<ProjectSummary[]>('/projects'),
  get: (id: string) => request<ProjectRecord>(`/projects/${id}`),
  create: (name: string, data?: ProjectData) =>
    request<ProjectRecord>('/projects', { method: 'POST', body: JSON.stringify({ name, data }) }),
  update: (id: string, name: string, data: ProjectData) =>
    request<ProjectRecord>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify({ name, data }) }),
  remove: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};
