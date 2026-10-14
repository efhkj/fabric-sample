import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  BaiduSearch,
  descriptorScore,
  mergeHits,
  parseSampleCode,
} from "./search";
export const db = new PrismaClient();
export const storage = path.resolve(
  process.env.STORAGE_DIR || "./data/uploads",
);
const baidu = new BaiduSearch();
export const mode = () =>
  process.env.SEARCH_MODE === "demo" ? "demo" : "baidu";
const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  type: z.enum(["text", "number", "select"]),
  required: z.boolean().default(false),
  showInResults: z.boolean().default(true),
  options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
const sampleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "编号仅支持字母、数字、下划线和横线"),
  name: z.string().trim().min(1).max(100),
  attributes: z
    .record(z.string(), z.union([z.string().max(1000), z.number().finite()]))
    .default({}),
});
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("；"),
    );
  return result.data;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
export const TEXTURE_PROFILE = "texture-gray-v1";
// Both indexing and querying use this exact pipeline. Keep display files in color.
export async function textureImage(buffer: Buffer) {
  return sharp(buffer)
    .greyscale()
    .toColourspace("srgb")
    .jpeg({ quality: 88 })
    .toBuffer();
}
export async function textureDescriptor(buffer: Buffer) {
  return Array.from(
    await sharp(buffer)
      .resize(16, 16, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer(),
  );
}
export async function normalizeImage(buffer: Buffer) {
  try {
    const input = sharp(buffer, { limitInputPixels: 40_000_000 });
    const meta = await input.metadata();
    if (
      !["jpeg", "png", "webp", "bmp"].includes(meta.format || "") ||
      !meta.width ||
      !meta.height
    )
      throw new Error("format");
    if (
      Math.min(meta.width, meta.height) < 50 ||
      Math.max(meta.width / meta.height, meta.height / meta.width) > 20
    )
      throw new Error("size");
    const normalized = await input
      .rotate()
      .flatten({ background: "#fff" })
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    if (
      new URLSearchParams({ image: normalized.toString("base64") }).toString()
        .length > 4_000_000
    )
      throw new Error("large");
    const thumb = await sharp(normalized)
      .resize({
        width: 420,
        height: 420,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    const searchImage = await textureImage(normalized);
    return {
      normalized,
      thumb,
      searchImage,
      descriptor: await textureDescriptor(searchImage),
      hash: createHash("sha256").update(normalized).digest("hex"),
    };
  } catch {
    throw new BadRequestException(
      "图片无法处理：请上传有效 JPG、PNG 或 WebP，短边至少 50 像素，长宽比不超过 20:1，像素总数不超过 4000 万。",
    );
  }
}
const includeImages = {
  images: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
  },
};
export class FabricService {
  private indexing = new Set<string>();
  async health() {
    let databaseConnected = false;
    try {
      await db.$queryRaw`SELECT 1`;
      databaseConnected = true;
    } catch {}
    return {
      databaseConnected,
      searchMode: mode(),
      searchProfile: TEXTURE_PROFILE,
      baiduConfigured: baidu.configured,
      searchType: process.env.BAIDU_SEARCH_TYPE || "materiel",
    };
  }
  fields() {
    return db.customField.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }
  async saveField(input: unknown, id?: string) {
    const data = validate(fieldSchema, input);
    if (data.type === "select" && !data.options.length)
      throw new BadRequestException("下拉字段至少需要一个选项");
    if (new Set(data.options).size !== data.options.length)
      throw new BadRequestException("下拉选项不能重复");
    if (id) {
      const old = await db.customField.findUnique({ where: { id } });
      if (!old) throw new NotFoundException("字段不存在");
      if (old.key !== data.key || old.type !== data.type)
        throw new BadRequestException("已创建字段的标识和类型不可更改");
    }
    try {
      return id
        ? await db.customField.update({ where: { id }, data })
        : await db.customField.create({ data });
    } catch (error: any) {
      if (error.code === "P2002") throw new ConflictException("字段标识已存在");
      throw error;
    }
  }
  async deleteField(id: string) {
    const field = await db.customField.findUnique({ where: { id } });
    if (!field) throw new NotFoundException("字段不存在");
    // Keep historical values in attributes; hidden fields can be restored with the same key.
    await db.customField.delete({ where: { id } });
    return { success: true };
  }
  async list(q: string, page: number, pageSize: number) {
    const where = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await db.$transaction([
      db.sample.findMany({
        where,
        include: includeImages,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.sample.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  async get(id: string) {
    const sample = await db.sample.findFirst({
      where: { id, deletedAt: null },
      include: includeImages,
    });
    if (!sample) throw new NotFoundException("样品不存在或已删除");
    return sample;
  }
  private async sampleData(input: unknown) {
    const data = validate(sampleSchema, input);
    for (const field of await this.fields()) {
      const value = data.attributes[field.key];
      if (field.required && (value === undefined || value === ""))
        throw new BadRequestException(`请填写${field.label}`);
      if (value !== undefined && value !== "") {
        if (field.type === "number" && typeof value !== "number")
          throw new BadRequestException(`${field.label}必须是数字`);
        if (field.type !== "number" && typeof value !== "string")
          throw new BadRequestException(`${field.label}必须是文本`);
        if (
          field.type === "select" &&
          !(field.options as string[]).includes(String(value))
        )
          throw new BadRequestException(`${field.label}不在允许的选项中`);
      }
    }
    return data;
  }
  async create(input: unknown, files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException("请至少上传一张图片");
    const data = await this.sampleData(input);
    const prepared = await this.prepare(files);
    let sample;
    try {
      sample = await db.sample.create({ data });
    } catch (error: any) {
      if (error.code === "P2002")
        throw new ConflictException(
          "样品编号已存在（包括已删除样品），请使用新编号",
        );
      throw error;
    }
    try {
      await this.storeImages(sample.id, prepared);
    } catch (error) {
      await db.sample.delete({ where: { id: sample.id } });
      throw error;
    }
    return this.get(sample.id);
  }
  async update(id: string, input: unknown) {
    const old = await this.get(id);
    const data = await this.sampleData(input);
    if (old.code !== data.code)
      throw new BadRequestException("样品编号创建后不可修改");
    return db.sample.update({ where: { id }, data, include: includeImages });
  }
  private async prepare(files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException("请选择图片");
    const prepared = [];
    for (const file of files) prepared.push(await normalizeImage(file.buffer));
    if (new Set(prepared.map((i) => i.hash)).size !== prepared.length)
      throw new ConflictException("本次上传包含重复图片");
    const duplicate = await db.sampleImage.findFirst({
      where: { hash: { in: prepared.map((i) => i.hash) } },
      include: { sample: true },
    });
    if (duplicate)
      throw new ConflictException(
        `图片已属于样品 ${duplicate.sample.code}，请勿重复上传`,
      );
    return prepared;
  }
  private async storeImages(
    sampleId: string,
    prepared: Awaited<ReturnType<FabricService["prepare"]>>,
  ) {
    await mkdir(storage, { recursive: true });
    const paths: string[] = [];
    const records: {
      id: string;
      sampleId: string;
      path: string;
      thumbnailPath: string;
      searchImagePath: string;
      hash: string;
      descriptor: number[];
    }[] = [];
    try {
      for (const image of prepared) {
        const id = randomUUID();
        const name = `${id}.jpg`;
        const thumbName = `${id}-thumb.jpg`;
        const searchName = `${id}-texture.jpg`;
        paths.push(path.join(storage, name), path.join(storage, thumbName));
        await writeFile(paths[paths.length - 2], image.normalized);
        await writeFile(paths[paths.length - 1], image.thumb);
        paths.push(path.join(storage, searchName));
        await writeFile(paths[paths.length - 1], image.searchImage);
        records.push({
          id,
          sampleId,
          path: `/uploads/${name}`,
          thumbnailPath: `/uploads/${thumbName}`,
          searchImagePath: `/uploads/${searchName}`,
          hash: image.hash,
          descriptor: image.descriptor,
        });
      }
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Sample" WHERE id = ${sampleId} FOR UPDATE`;
        const sample = await tx.sample.findUnique({ where: { id: sampleId } });
        if (!sample || sample.deletedAt)
          throw new NotFoundException("样品已删除");
        const count = await tx.sampleImage.count({
          where: { sampleId, deletedAt: null },
        });
        if (count + records.length > 12)
          throw new BadRequestException("每个样品最多 12 张图片");
        for (const data of records) await tx.sampleImage.create({ data });
      });
    } catch (error: any) {
      await Promise.all(paths.map((file) => unlink(file).catch(() => {})));
      if (error.code === "P2002")
        throw new ConflictException("图片已上传，请刷新后检查");
      throw error;
    }
    // Persist first, then call external service. Failed indexing is retryable.
    for (const record of records) await this.index(record.id);
  }
  async addImages(id: string, files: Express.Multer.File[]) {
    const sample = await this.get(id);
    if (sample.images.length + files.length > 12)
      throw new BadRequestException("每个样品最多 12 张图片");
    await this.storeImages(id, await this.prepare(files));
    return this.get(id);
  }
  async index(id: string) {
    if (this.indexing.has(id))
      throw new ConflictException("该图片正在同步，请稍后刷新");
    const image = await db.sampleImage.findUnique({
      where: { id },
      include: { sample: true },
    });
    if (!image || image.deletedAt || image.sample.deletedAt)
      throw new NotFoundException("图片不存在");
    if (
      image.indexStatus === "indexed" &&
      image.indexMode === mode() &&
      image.indexProfile === TEXTURE_PROFILE
    )
      return image;
    if (image.contSign && image.indexMode && image.indexMode !== mode())
      throw new ConflictException(
        "已有索引的图片不能直接切换搜索模式，请按 README 的模式切换说明操作",
      );
    this.indexing.add(id);
    try {
      await db.sampleImage.update({
        where: { id },
        data: { indexStatus: "indexing", lastError: null },
      });
      // Retire a legacy color index before replacing it. A failed removal keeps its
      // signature for retry; search only considers completed current-profile indexes.
      if (
        image.contSign &&
        image.indexMode === "baidu" &&
        image.indexProfile !== TEXTURE_PROFILE
      ) {
        await baidu.remove(image.contSign);
        await db.sampleImage.update({
          where: { id },
          data: { contSign: null },
        });
      }
      const searchImage = await textureImage(
        await readFile(path.join(storage, path.basename(image.path))),
      );
      const searchImagePath = `/uploads/${id}-texture.jpg`;
      await writeFile(path.join(storage, `${id}-texture.jpg`), searchImage);
      await db.sampleImage.update({
        where: { id },
        data: {
          searchImagePath,
          descriptor: await textureDescriptor(searchImage),
        },
      });
      const result =
        mode() === "demo"
          ? { cont_sign: `demo:${id}` }
          : await baidu.add(
              searchImage,
              JSON.stringify({ code: image.sample.code }),
            );
      if (!result.cont_sign) throw new Error("百度未返回图片签名");
      // Deletion can happen while indexing is in flight; never resurrect a deleted record.
      const current = await db.sampleImage.findUnique({
        where: { id },
        include: { sample: true },
      });
      const removed = !!current?.deletedAt || !!current?.sample.deletedAt;
      const record = await db.sampleImage.update({
        where: { id },
        data: {
          contSign: result.cont_sign,
          indexMode: mode(),
          indexProfile: TEXTURE_PROFILE,
          indexStatus: removed ? "delete_pending" : "indexed",
          lastError: null,
        },
      });
      if (removed) await this.cleanIndex(id);
      return record;
    } catch (error) {
      return db.sampleImage.update({
        where: { id },
        data: { indexStatus: "failed", lastError: message(error) },
      });
    } finally {
      this.indexing.delete(id);
    }
  }
  async cleanIndex(id: string) {
    const image = await db.sampleImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException("图片不存在");
    if (!image.deletedAt) throw new BadRequestException("图片尚未删除");
    try {
      if (image.contSign && image.indexMode === "baidu")
        await baidu.remove(image.contSign);
      return await db.sampleImage.update({
        where: { id },
        data: { indexStatus: "deleted", lastError: null },
      });
    } catch (error) {
      return db.sampleImage.update({
        where: { id },
        data: { indexStatus: "delete_pending", lastError: message(error) },
      });
    }
  }
  async deleteSample(id: string) {
    const sample = await this.get(id);
    if (sample.images.some((image) => this.indexing.has(image.id)))
      throw new ConflictException("图片正在同步，请稍后删除");
    await db.$transaction([
      db.sample.update({ where: { id }, data: { deletedAt: new Date() } }),
      db.sampleImage.updateMany({
        where: { sampleId: id, deletedAt: null },
        data: { deletedAt: new Date(), indexStatus: "delete_pending" },
      }),
    ]);
    for (const image of sample.images) await this.cleanIndex(image.id);
    return { success: true };
  }
  async deleteImage(id: string) {
    if (this.indexing.has(id))
      throw new ConflictException("图片正在同步，请稍后删除");
    const image = await db.sampleImage.findUnique({ where: { id } });
    if (!image || image.deletedAt) throw new NotFoundException("图片不存在");
    // Serialize removals for one sample so concurrent requests cannot remove its last image.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Sample" WHERE id = ${image.sampleId} FOR UPDATE`;
      const count = await tx.sampleImage.count({
        where: { sampleId: image.sampleId, deletedAt: null },
      });
      if (count <= 1) throw new BadRequestException("样品至少保留一张图片");
      await tx.sampleImage.update({
        where: { id },
        data: { deletedAt: new Date(), indexStatus: "delete_pending" },
      });
    });
    return this.cleanIndex(id);
  }
  cleanupTasks() {
    return db.sampleImage.findMany({
      where: { indexStatus: "delete_pending" },
      include: { sample: { select: { code: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
  async search(file: Express.Multer.File, limit: number, minScore: number) {
    if (!file) throw new BadRequestException("请选择查询图片");
    const started = Date.now();
    const image = await normalizeImage(file.buffer);
    const active = {
      deletedAt: null,
      indexStatus: "indexed",
      indexMode: mode(),
      indexProfile: TEXTURE_PROFILE,
      sample: { deletedAt: null },
    };
    type Candidate = Prisma.SampleImageGetPayload<{
      include: { sample: true };
    }>;
    let mapped: { sampleId: string; score: number; image: Candidate }[];
    if (mode() === "demo") {
      const candidates = await db.sampleImage.findMany({
        where: active,
        include: { sample: true },
      });
      mapped = candidates.map((candidate) => ({
        sampleId: candidate.sampleId,
        score: descriptorScore(
          image.descriptor,
          candidate.descriptor as number[],
        ),
        image: candidate,
      }));
    } else {
      const hits = await baidu.search(image.searchImage);
      const parsed = hits.flatMap((hit) => {
        const code = parseSampleCode(hit.brief);
        return code ? [{ hit, code }] : [];
      });
      // Resolve business data by sample code; cont_sign identifies the matched local photo.
      const candidates = await db.sampleImage.findMany({
        where: {
          ...active,
          sample: {
            deletedAt: null,
            code: { in: parsed.map(({ code }) => code) },
          },
        },
        include: { sample: true },
      });
      const bySign = new Map(
        candidates.map((candidate) => [candidate.contSign, candidate]),
      );
      mapped = parsed.flatMap(({ hit, code }) => {
        const candidate = bySign.get(hit.cont_sign);
        if (!candidate || candidate.sample.code !== code) return [];
        return [
          {
            sampleId: candidate.sampleId,
            score: Math.max(0, Math.min(1, hit.score)),
            image: candidate,
          },
        ];
      });
    }
    const grouped = mergeHits(mapped.filter((hit) => hit.score >= minScore));
    return {
      mode: mode(),
      searchProfile: TEXTURE_PROFILE,
      durationMs: Date.now() - started,
      matchedSamples: grouped.length,
      scannedImages: mapped.length,
      items: grouped.slice(0, limit).map((hit) => ({
        ...hit.image.sample,
        score: hit.score,
        matchedImage: {
          id: hit.image.id,
          path: hit.image.path,
          thumbnailPath: hit.image.thumbnailPath,
        },
      })),
    };
  }
}
