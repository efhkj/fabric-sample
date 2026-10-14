import { createHmac } from "node:crypto";
import {
  BadGatewayException,
  ServiceUnavailableException,
} from "@nestjs/common";
export type Hit = { cont_sign: string; score: number; brief: string };
export function mergeHits<T extends { sampleId: string; score: number }>(
  hits: T[],
): T[] {
  const grouped = new Map<string, T>();
  for (const hit of hits)
    if (
      !grouped.has(hit.sampleId) ||
      hit.score > grouped.get(hit.sampleId)!.score
    )
      grouped.set(hit.sampleId, hit);
  return [...grouped.values()].sort((a, b) => b.score - a.score);
}
export function descriptorScore(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  const distance = a.reduce((sum, n, i) => sum + (n - b[i]) ** 2, 0) / a.length;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(distance) / 255));
}
export function parseSampleCode(brief: string): string | null {
  try {
    const value = JSON.parse(brief);
    const code = typeof value === "string" ? value : value?.code;
    return typeof code === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(code)
      ? code
      : null;
  } catch {
    return /^[a-zA-Z0-9_-]{1,64}$/.test(brief) ? brief : null;
  }
}
export function signBaiduRequest(
  accessKey: string,
  secretKey: string,
  pathname: string,
  timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
) {
  const host = "aip.baidubce.com";
  const encode = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const hmac = (key: string, value: string) =>
    createHmac("sha256", key).update(value).digest("hex");
  const prefix = `bce-auth-v1/${accessKey}/${timestamp}/1800`;
  const canonical = [
    "POST",
    pathname.split("/").map(encode).join("/"),
    "",
    `host:${encode(host)}\nx-bce-date:${encode(timestamp)}`,
  ].join("\n");
  const signature = hmac(hmac(secretKey, prefix), canonical);
  return {
    Authorization: `${prefix}/host;x-bce-date/${signature}`,
    "x-bce-date": timestamp,
  };
}
export class BaiduSearch {
  private token = "";
  private expiresAt = 0;
  get authMode() {
    return (
      process.env.BAIDU_AUTH_MODE ||
      (process.env.BAIDU_ACCESS_KEY_ID ? "aksk" : "oauth")
    );
  }
  get configured() {
    return this.authMode === "aksk"
      ? Boolean(
          process.env.BAIDU_ACCESS_KEY_ID &&
          process.env.BAIDU_ACCESS_KEY_SECRET,
        )
      : Boolean(process.env.BAIDU_API_KEY && process.env.BAIDU_SECRET_KEY);
  }
  private async accessToken() {
    if (!this.configured)
      throw new ServiceUnavailableException(
        "图片检索服务尚未配置，请联系维护人员。",
      );
    if (this.token && Date.now() < this.expiresAt) return this.token;
    const url = new URL("https://aip.baidubce.com/oauth/2.0/token");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.BAIDU_API_KEY!,
      client_secret: process.env.BAIDU_SECRET_KEY!,
    });
    const response = await fetch(url, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as any;
    if (!response.ok || !data.access_token)
      throw new BadGatewayException("百度授权失败，请检查密钥和应用权限。");
    this.token = data.access_token;
    this.expiresAt =
      Date.now() + Math.max(0, Number(data.expires_in) - 300) * 1000;
    return this.token;
  }
  async call(
    action: "add" | "search" | "delete",
    params: Record<string, string>,
  ): Promise<any> {
    const type = process.env.BAIDU_SEARCH_TYPE || "materiel";
    if (!["materiel", "similar"].includes(type))
      throw new ServiceUnavailableException(
        "BAIDU_SEARCH_TYPE 必须为 materiel 或 similar",
      );
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!["aksk", "oauth"].includes(this.authMode))
        throw new ServiceUnavailableException(
          "图片检索鉴权配置无效，请联系维护人员。",
        );
      if (!this.configured)
        throw new ServiceUnavailableException(
          "图片检索服务尚未配置，请联系维护人员。",
        );
      const pathname = `/rest/2.0/image-classify/v1/realtime_search/${type}/${action}`;
      const signed = this.authMode === "aksk";
      const token = signed ? "" : await this.accessToken();
      const url = `https://aip.baidubce.com${pathname}${signed ? "" : `?access_token=${encodeURIComponent(token)}`}`;
      const headers: Record<string, string> = signed
        ? signBaiduRequest(
            process.env.BAIDU_ACCESS_KEY_ID!,
            process.env.BAIDU_ACCESS_KEY_SECRET!,
            pathname,
          )
        : {};
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: new URLSearchParams(params),
          signal: AbortSignal.timeout(25000),
        });
      } catch {
        throw new BadGatewayException(
          "百度服务请求超时或网络不可用，请稍后重试。",
        );
      }
      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new BadGatewayException("百度服务返回了无效响应。");
      }
      if (
        !signed &&
        [110, 111].includes(Number(data.error_code)) &&
        attempt === 0
      ) {
        this.token = "";
        this.expiresAt = 0;
        continue;
      }
      if (!response.ok || data.error_code) {
        if (Number(data.error_code) === 14)
          throw new BadGatewayException(
            "百度身份验证失败（错误码 14），请检查 AccessKey 完整性及图像搜索授权。",
          );
        // Do not expose token-bearing request URLs or raw credential errors.
        throw new BadGatewayException(
          `百度接口失败（错误码 ${data.error_code || response.status}，日志 ${data.log_id || "无"}），请检查图库权限、额度或图片是否重复。`,
        );
      }
      return data;
    }
    throw new BadGatewayException("百度访问令牌失效。");
  }
  add(image: Buffer, brief: string) {
    return this.call("add", { image: image.toString("base64"), brief });
  }
  remove(contSign: string) {
    return this.call("delete", { cont_sign: contSign });
  }
  async search(image: Buffer): Promise<Hit[]> {
    const hits: Hit[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const data = await this.call("search", {
        image: image.toString("base64"),
        pn: String(offset),
        rn: "100",
      });
      if (!Array.isArray(data.result))
        throw new BadGatewayException("百度检索结果格式不正确。");
      hits.push(
        ...data.result.filter(
          (hit: any) =>
            typeof hit.cont_sign === "string" &&
            typeof hit.brief === "string" &&
            Number.isFinite(hit.score),
        ),
      );
      if (
        !(data.has_more === true || data.has_more === "true") ||
        data.result.length < 100
      )
        break;
    }
    return hits;
  }
}
