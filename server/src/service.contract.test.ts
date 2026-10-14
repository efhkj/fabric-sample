import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  FabricService,
  db,
  storage,
  textureImage,
  TEXTURE_PROFILE,
} from "./service";
import { BaiduSearch } from "./search";

test("real indexing sends only sample code and image to Baidu, then saves its signature", async () => {
  const originalFind = db.sampleImage.findUnique;
  const originalUpdate = db.sampleImage.update;
  const originalAdd = BaiduSearch.prototype.add;
  const originalRemove = BaiduSearch.prototype.remove;
  const originalMode = process.env.SEARCH_MODE;
  process.env.SEARCH_MODE = "baidu";
  const id = randomUUID();
  const imagePath = path.join(storage, `${id}.jpg`);
  await mkdir(storage, { recursive: true });
  const colorImage = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer();
  const expectedGray = await textureImage(colorImage);
  await writeFile(imagePath, colorImage);
  const sample = {
    id: "sample-internal",
    code: "YL-101",
    name: "fabric",
    attributes: { weight: 180 },
    deletedAt: null,
  };
  let image: any = {
    id,
    sampleId: sample.id,
    sample,
    path: `/uploads/${id}.jpg`,
    indexStatus: "pending",
    indexMode: null,
    contSign: null,
    deletedAt: null,
  };
  (db.sampleImage as any).findUnique = async () => image;
  (db.sampleImage as any).update = async ({ data }: any) => {
    image = { ...image, ...data };
    return image;
  };
  BaiduSearch.prototype.add = async (buffer, brief) => {
    assert.deepEqual(buffer, expectedGray);
    assert.deepEqual(JSON.parse(brief), { code: "YL-101" });
    return { cont_sign: "real-signature" };
  };
  try {
    const result = await new FabricService().index(id);
    assert.equal(result.contSign, "real-signature");
    assert.equal(result.indexStatus, "indexed");
    assert.equal(result.indexMode, "baidu");
    assert.equal(result.indexProfile, TEXTURE_PROFILE);
    assert.deepEqual(await readFile(imagePath), colorImage);
    assert.deepEqual(
      await readFile(path.join(storage, `${id}-texture.jpg`)),
      expectedGray,
    );
    // Legacy migration cannot lose the old signature when external deletion fails.
    image = { ...image, indexProfile: null, contSign: "legacy-signature" };
    BaiduSearch.prototype.remove = async () => {
      throw new Error("delete unavailable");
    };
    const failed = await new FabricService().index(id);
    assert.equal(failed.indexStatus, "failed");
    assert.equal(failed.contSign, "legacy-signature");
    assert.equal(failed.indexProfile, null);
    const events: string[] = [];
    BaiduSearch.prototype.remove = async (sign) => {
      assert.equal(sign, "legacy-signature");
      events.push("delete-color");
    };
    const grayAdd = BaiduSearch.prototype.add;
    BaiduSearch.prototype.add = async (...args) => {
      events.push("add-gray");
      return grayAdd(...args);
    };
    const migrated = await new FabricService().index(id);
    assert.deepEqual(events, ["delete-color", "add-gray"]);
    assert.equal(migrated.indexStatus, "indexed");
    assert.equal(migrated.indexProfile, TEXTURE_PROFILE);
  } finally {
    db.sampleImage.findUnique = originalFind;
    db.sampleImage.update = originalUpdate;
    BaiduSearch.prototype.add = originalAdd;
    BaiduSearch.prototype.remove = originalRemove;
    if (originalMode === undefined) delete process.env.SEARCH_MODE;
    else process.env.SEARCH_MODE = originalMode;
    await unlink(imagePath);
    await unlink(path.join(storage, `${id}-texture.jpg`));
  }
});

test("real search calls Baidu first and retrieves local records by returned sample codes", async () => {
  const originalFind = db.sampleImage.findMany;
  const originalSearch = BaiduSearch.prototype.search;
  const originalMode = process.env.SEARCH_MODE;
  process.env.SEARCH_MODE = "baidu";
  const calls: string[] = [];
  const sample = {
    id: "sample-a",
    code: "YL-101",
    name: "蓝色面料",
    attributes: { composition: "棉", weight: 180 },
    createdAt: new Date(),
  };
  const candidate = (id: string, contSign: string) => ({
    id,
    sampleId: sample.id,
    sample,
    contSign,
    path: `/uploads/${id}.jpg`,
    thumbnailPath: `/uploads/${id}-thumb.jpg`,
  });
  BaiduSearch.prototype.search = async (buffer) => {
    const { data, info } = await sharp(buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 3);
    for (let i = 0; i < data.length; i += 3) {
      assert.equal(data[i], data[i + 1]);
      assert.equal(data[i + 1], data[i + 2]);
    }
    calls.push("baidu");
    return [
      { cont_sign: "sign-one", score: 0.7, brief: '{"code":"YL-101"}' },
      { cont_sign: "sign-two", score: 0.92, brief: '{"code":"YL-101"}' },
      { cont_sign: "sign-stale", score: 0.99, brief: '{"code":"DELETED"}' },
      { cont_sign: "sign-one", score: 0.99, brief: '{"code":"WRONG-CODE"}' },
    ];
  };
  (db.sampleImage as any).findMany = async ({ where }: any) => {
    calls.push("business-db");
    assert.deepEqual(where.sample.code.in, [
      "YL-101",
      "YL-101",
      "DELETED",
      "WRONG-CODE",
    ]);
    assert.equal(where.deletedAt, null);
    assert.equal(where.sample.deletedAt, null);
    assert.equal(where.indexMode, "baidu");
    assert.equal(where.indexStatus, "indexed");
    assert.equal(where.indexProfile, TEXTURE_PROFILE);
    return [candidate("one", "sign-one"), candidate("two", "sign-two")];
  };
  try {
    const buffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const result = await new FabricService().search(
      { buffer } as Express.Multer.File,
      20,
      0,
    );
    assert.deepEqual(calls, ["baidu", "business-db"]);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].score, 0.92);
    assert.equal(result.items[0].name, "蓝色面料");
    assert.deepEqual(result.items[0].attributes, {
      composition: "棉",
      weight: 180,
    });
    assert.equal(result.items[0].matchedImage.path, "/uploads/two.jpg");
  } finally {
    db.sampleImage.findMany = originalFind;
    BaiduSearch.prototype.search = originalSearch;
    if (originalMode === undefined) delete process.env.SEARCH_MODE;
    else process.env.SEARCH_MODE = originalMode;
  }
});
