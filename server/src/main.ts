import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpException,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Body,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { NestExpressApplication } from "@nestjs/platform-express";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { FabricService, db, storage } from "./service";
import type { Request, Response, NextFunction } from "express";
const service = new FabricService();
const upload = {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 12,
    fields: 10,
    fieldSize: 64 * 1024,
  },
};
const integer = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new BadRequestException(`参数必须为 ${min} 到 ${max} 的整数`);
  return value;
};
@Controller("api")
class ApiController {
  @Get("health") health() {
    return service.health();
  }
  @Get("samples") list(
    @Query("q") q = "",
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return service.list(
      q.slice(0, 100),
      integer(page, 1, 1, 100000),
      integer(pageSize, 12, 1, 100),
    );
  }
  @Get("samples/:id") get(@Param("id") id: string) {
    return service.get(id);
  }
  @Post("samples")
  @UseInterceptors(FilesInterceptor("images", 12, upload))
  create(
    @Body("data") raw: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new BadRequestException("样品资料格式无效");
    }
    return service.create(data, files);
  }
  @Patch("samples/:id") update(@Param("id") id: string, @Body() body: unknown) {
    return service.update(id, body);
  }
  @Delete("samples/:id") remove(@Param("id") id: string) {
    return service.deleteSample(id);
  }
  @Post("samples/:id/images")
  @UseInterceptors(FilesInterceptor("images", 12, upload))
  addImages(
    @Param("id") id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return service.addImages(id, files || []);
  }
  @Delete("images/:id") deleteImage(@Param("id") id: string) {
    return service.deleteImage(id);
  }
  @Post("images/:id/retry-index") index(@Param("id") id: string) {
    return service.index(id);
  }
  @Get("cleanup-tasks") tasks() {
    return service.cleanupTasks();
  }
  @Post("images/:id/retry-delete") retryDelete(@Param("id") id: string) {
    return service.cleanIndex(id);
  }
  @Get("custom-fields") fields() {
    return service.fields();
  }
  @Post("custom-fields") createField(@Body() body: unknown) {
    return service.saveField(body);
  }
  @Patch("custom-fields/:id") updateField(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return service.saveField(body, id);
  }
  @Delete("custom-fields/:id") deleteField(@Param("id") id: string) {
    return service.deleteField(id);
  }
  @Post("image-search")
  @UseInterceptors(
    FileInterceptor("image", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  search(
    @UploadedFile() file: Express.Multer.File,
    @Body("limit") limit?: string,
    @Body("minScore") score?: string,
  ) {
    const minScore = score === undefined ? 0 : Number(score);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1)
      throw new BadRequestException("最低相似度必须在 0 到 1 之间");
    return service.search(file, integer(limit, 20, 1, 100), minScore);
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
async function main() {
  if (
    process.env.SEARCH_MODE &&
    !["demo", "baidu"].includes(process.env.SEARCH_MODE)
  )
    throw new Error("SEARCH_MODE must be baidu or demo");
  await mkdir(storage, { recursive: true });
  try {
    await db.$connect();
    // A restart interrupts requests; make unfinished operations retryable.
    await db.sampleImage.updateMany({
      where: { indexStatus: "indexing", deletedAt: null },
      data: { indexStatus: "failed", lastError: "同步被服务重启中断，请重试" },
    });
  } catch {
    console.warn(
      "数据库暂时无法连接或尚未初始化；页面可访问，业务操作需等待数据库恢复。",
    );
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || "http://127.0.0.1:5173").split(","),
  });
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const response = host.switchToHttp().getResponse();
      const unavailable =
        exception?.name === "PrismaClientInitializationError" ||
        ["P1000", "P1001", "P1002", "P2021"].includes(exception?.code);
      const status = unavailable
        ? 503
        : exception instanceof HttpException
          ? exception.getStatus()
          : 500;
      response.status(status).json({
        message: unavailable
          ? "数据库暂时无法连接，请稍后重试。"
          : status === 500
            ? "服务暂时异常，请稍后重试。"
            : exception.message,
        statusCode: status,
      });
      if (status === 500) console.error(exception);
    },
  });
  const buckets = new Map<string, { count: number; reset: number }>();
  const timer = setInterval(() => {
    for (const [key, value] of buckets)
      if (value.reset < Date.now()) buckets.delete(key);
  }, 60000);
  timer.unref();
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "local";
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + 60000 };
      buckets.set(key, entry);
    }
    if (++entry.count > 90)
      return res.status(429).json({ message: "请求过于频繁，请一分钟后重试" });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.useStaticAssets(storage, {
    prefix: "/uploads/",
    index: false,
    dotfiles: "deny",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  });
  const client = resolve(__dirname, "../../client/dist");
  if (existsSync(client)) {
    app.useStaticAssets(client);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        req.method === "GET" &&
        !req.path.startsWith("/api") &&
        !req.path.startsWith("/uploads")
      )
        return res.sendFile(resolve(client, "index.html"));
      next();
    });
  }
  await app.listen(
    Number(process.env.PORT || 3001),
    process.env.HOST || "127.0.0.1",
  );
  console.log(
    `Fabric Sample: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      clearInterval(timer);
      await app.close();
      await db.$disconnect();
      process.exit(0);
    });
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
