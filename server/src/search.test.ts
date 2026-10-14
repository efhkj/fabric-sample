import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptorScore, mergeHits } from "./search";
import { normalizeImage } from "./service";
import sharp from "sharp";
// Keep mocked OAuth tests independent of the developer credential configuration.
process.env.BAIDU_AUTH_MODE = "oauth";
test("same sample retains highest-scoring matched image and sorts descending", () => {
  const result = mergeHits([
    { sampleId: "a", score: 0.4, image: "one" },
    { sampleId: "b", score: 0.8, image: "two" },
    { sampleId: "a", score: 0.9, image: "three" },
  ]);
  assert.deepEqual(
    result.map((i) => [i.sampleId, i.image]),
    [
      ["a", "three"],
      ["b", "two"],
    ],
  );
});
test("demo descriptor exact image scores one; different color scores lower", () => {
  assert.equal(descriptorScore([10, 20, 30], [10, 20, 30]), 1);
  assert.ok(descriptorScore([0, 0, 0], [255, 255, 255]) < 0.01);
});
test("normalization rejects disguised uploads and tiny images", async () => {
  await assert.rejects(normalizeImage(Buffer.from("<script>bad</script>")));
  await assert.rejects(
    normalizeImage(
      await sharp({
        create: { width: 20, height: 20, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
    ),
  );
});
test("normalized image yields deterministic hash and valid thumbnail", async () => {
  const input = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const a = await normalizeImage(input);
  const b = await normalizeImage(input);
  assert.equal(a.hash, b.hash);
  assert.equal(a.descriptor.length, 16 * 16 * 3);
  assert.equal((await sharp(a.thumb).metadata()).format, "jpeg");
});
test("Baidu adapter sends encoded image, returns candidates and treats string false correctly", async () => {
  const { BaiduSearch } = await import("./search");
  const original = globalThis.fetch;
  const oldKey = process.env.BAIDU_API_KEY;
  const oldSecret = process.env.BAIDU_SECRET_KEY;
  process.env.BAIDU_API_KEY = "test-key";
  process.env.BAIDU_SECRET_KEY = "test-secret";
  let count = 0;
  globalThis.fetch = (async (url: any, options: any) => {
    count++;
    if (String(url).includes("oauth"))
      return new Response(
        JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
      );
    assert.ok(String(url).includes("/materiel/search"));
    assert.equal(
      options.body.get("image"),
      Buffer.from("image").toString("base64"),
    );
    assert.equal(options.body.get("pn"), "0");
    return new Response(
      JSON.stringify({
        result: [
          { cont_sign: "sign", brief: '{"sid":"a","iid":"b"}', score: 0.9 },
        ],
        has_more: "false",
      }),
    );
  }) as typeof fetch;
  try {
    const adapter = new BaiduSearch();
    assert.equal((await adapter.search(Buffer.from("image"))).length, 1);
    assert.equal(count, 2);
    await adapter.search(Buffer.from("image"));
    assert.equal(count, 3, "token reused");
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.BAIDU_API_KEY;
    else process.env.BAIDU_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.BAIDU_SECRET_KEY;
    else process.env.BAIDU_SECRET_KEY = oldSecret;
  }
});
test("Baidu errors are surfaced rather than converted to zero matches", async () => {
  const { BaiduSearch } = await import("./search");
  const original = globalThis.fetch;
  const oldKey = process.env.BAIDU_API_KEY;
  const oldSecret = process.env.BAIDU_SECRET_KEY;
  process.env.BAIDU_API_KEY = "test-key";
  process.env.BAIDU_SECRET_KEY = "test-secret";
  globalThis.fetch = (async (url: any) =>
    new Response(
      JSON.stringify(
        String(url).includes("oauth")
          ? { access_token: "test-token", expires_in: 3600 }
          : { error_code: 18, log_id: 123 },
      ),
    )) as typeof fetch;
  try {
    await assert.rejects(
      new BaiduSearch().search(Buffer.from("image")),
      /错误码 18/,
    );
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.BAIDU_API_KEY;
    else process.env.BAIDU_API_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.BAIDU_SECRET_KEY;
    else process.env.BAIDU_SECRET_KEY = oldSecret;
  }
});
test("sample code is read from code-only brief and supports older briefs", async () => {
  const { parseSampleCode } = await import("./search");
  assert.equal(parseSampleCode('{"code":"YL-001"}'), "YL-001");
  assert.equal(
    parseSampleCode('{"sid":"old-id","code":"YL-002","iid":"old-photo"}'),
    "YL-002",
  );
  assert.equal(parseSampleCode("YL-003"), "YL-003");
  assert.equal(parseSampleCode('{"iid":"only-photo"}'), null);
  assert.equal(parseSampleCode(""), null);
});
test("AccessKey authentication signs the request without OAuth or access_token", async () => {
  const { BaiduSearch, signBaiduRequest } = await import("./search");
  const original = globalThis.fetch;
  const names = [
    "BAIDU_AUTH_MODE",
    "BAIDU_ACCESS_KEY_ID",
    "BAIDU_ACCESS_KEY_SECRET",
  ];
  const saved = names.map((name) => process.env[name]);
  Object.assign(process.env, {
    BAIDU_AUTH_MODE: "aksk",
    BAIDU_ACCESS_KEY_ID: "test-ak",
    BAIDU_ACCESS_KEY_SECRET: "test-sk",
  });
  let count = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    count++;
    assert.equal(
      String(url),
      "https://aip.baidubce.com/rest/2.0/image-classify/v1/realtime_search/materiel/search",
    );
    assert.equal(
      init.headers.Authorization,
      signBaiduRequest(
        "test-ak",
        "test-sk",
        new URL(url).pathname,
        init.headers["x-bce-date"],
      ).Authorization,
    );
    assert.match(
      init.headers.Authorization,
      /^bce-auth-v1\/test-ak\/.+\/1800\/host;x-bce-date\/[a-f0-9]{64}$/,
    );
    return new Response(JSON.stringify({ result: [], has_more: false }));
  }) as typeof fetch;
  try {
    await new BaiduSearch().search(Buffer.from("image"));
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = original;
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

test("texture normalization preserves color display and produces deterministic grayscale search images", async () => {
  const { normalizeImage, textureImage } = await import("./service");
  const source = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const prepared = await normalizeImage(source);
  assert.deepEqual(
    prepared.searchImage,
    await textureImage(prepared.normalized),
  );
  const color = await sharp(prepared.normalized).raw().toBuffer();
  const gray = await sharp(prepared.searchImage).raw().toBuffer();
  assert.ok(color[0] > color[1] + 100);
  for (let i = 0; i < gray.length; i += 3) {
    assert.equal(gray[i], gray[i + 1]);
    assert.equal(gray[i + 1], gray[i + 2]);
  }
});
