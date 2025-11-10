const meta = (import.meta as any);
export const API_BASE: string =
  meta?.env?.VITE_API_BASE_URL ?? 'http://localhost:8787';