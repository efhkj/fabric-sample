import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3001/api";
const suffix = Date.now();
const sampleIds = [];
const fieldIds = [];
async function request(path, init, expected = 200) {
  const response = await fetch(base + path, init);
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const json = (method, data) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
const png = (color) =>
  sharp({ create: { width: 180, height: 120, channels: 3, background: color } })
    .composite([
      {
        input: randomBytes(300),
        raw: { width: 10, height: 10, channels: 3 },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
function sampleBody(code, image, values = {}, name = "接口测试样品") {
  const body = new FormData();
  body.append("data", JSON.stringify({ code, name, attributes: values }));
  body.append("images", new Blob([image]), "fabric.png");
  return body;
}
function searchBody(image) {
  const body = new FormData();
  body.append("image", new Blob([image]), "query.png");
  return body;
}
try {
  assert.equal(
    (await request("/health")).searchMode,
    "demo",
    "Run server in SEARCH_MODE=demo for these tests",
  );
  const field = await request(
    "/custom-fields",
    json("POST", {
      key: `test_${suffix}`,
      label: "测试克重",
      type: "number",
      required: true,
    }),
    201,
  );
  fieldIds.push(field.id);
  const blue = await png("#314c9e"),
    red = await png("#ba382f"),
    green = await png("#2e9165");
  await request(
    "/samples",
    { method: "POST", body: sampleBody(`TEST-${suffix}`, blue) },
    400,
  );
  const a = await request(
    "/samples",
    {
      method: "POST",
      body: sampleBody(`TEST-${suffix}`, blue, { [field.key]: 180 }),
    },
    201,
  );
  sampleIds.push(a.id);
  assert.equal(a.images[0].indexStatus, "indexed");
  await request(
    "/samples",
    {
      method: "POST",
      body: sampleBody(`DUP-${suffix}`, blue, { [field.key]: 180 }),
    },
    409,
  );
  await request(
    "/samples",
    {
      method: "POST",
      body: sampleBody(`TEST-${suffix}`, red, { [field.key]: 180 }),
    },
    409,
  );
  await request(
    `/samples/${a.id}`,
    json("PATCH", {
      code: "CHANGED",
      name: "禁止改号",
      attributes: { [field.key]: 180 },
    }),
    400,
  );
  const b = await request(
    "/samples",
    {
      method: "POST",
      body: sampleBody(`OTHER-${suffix}`, red, { [field.key]: 190 }),
    },
    201,
  );
  sampleIds.push(b.id);
  const more = new FormData();
  more.append("images", new Blob([green]), "green.png");
  const added = await request(
    `/samples/${a.id}/images`,
    { method: "POST", body: more },
    201,
  );
  assert.equal(added.images.length, 2);
  const result = await request(
    "/image-search",
    { method: "POST", body: searchBody(blue) },
    201,
  );
  assert.equal(result.items[0].id, a.id);
  assert.equal(result.items[0].score, 1);
  assert.equal(result.items.filter((item) => item.id === a.id).length, 1);
  assert.equal(result.items[0].attributes[field.key], 180);
  const filtered = searchBody(blue);
  filtered.append("minScore", "1");
  assert.equal(
    (await request("/image-search", { method: "POST", body: filtered }, 201))
      .items.length,
    1,
  );
  await request(`/images/${added.images[1].id}`, { method: "DELETE" });
  await request(`/images/${a.images[0].id}`, { method: "DELETE" }, 400);
  await request(`/samples/${a.id}`, { method: "DELETE" });
  assert.ok(
    !(
      await request(
        "/image-search",
        { method: "POST", body: searchBody(blue) },
        201,
      )
    ).items.some((item) => item.id === a.id),
  );
  await request("/samples?page=abc", undefined, 400);
  const fake = new FormData();
  fake.append("image", new Blob(["not-an-image"]), "bad.png");
  await request("/image-search", { method: "POST", body: fake }, 400);
  console.log(
    "PASS: required attributes, create/index, duplicate image/code, immutable code, append images, search ranking/dedup/filter, deletion filtering, last-image protection, invalid image/query.",
  );
} finally {
  for (const id of sampleIds)
    await fetch(`${base}/samples/${id}`, { method: "DELETE" });
  for (const id of fieldIds)
    await fetch(`${base}/custom-fields/${id}`, { method: "DELETE" });
}
