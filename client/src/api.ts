export type Field = {
  id: string;
  key: string;
  label: string;
  type: "text" | "number" | "select";
  required: boolean;
  showInResults: boolean;
  options: string[];
  sortOrder: number;
};
export type SampleImage = {
  id: string;
  path: string;
  thumbnailPath: string;
  indexStatus: string;
  indexMode: string | null;
  indexProfile: string | null;
  searchImagePath: string | null;
  lastError: string | null;
};
export type Sample = {
  id: string;
  code: string;
  name: string;
  attributes: Record<string, string | number>;
  images: SampleImage[];
  createdAt: string;
};
export type SearchItem = Sample & { score: number; matchedImage: SampleImage };
export type SearchResult = {
  mode: string;
  searchProfile: string;
  durationMs: number;
  matchedSamples: number;
  scannedImages: number;
  items: SearchItem[];
};
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 360000);
  try {
    const response = await fetch(`/api${url}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options?.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options?.headers,
      },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        Array.isArray(data.message)
          ? data.message.join("；")
          : data.message || "请求失败",
      );
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("请求超时，请刷新检查处理状态。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
