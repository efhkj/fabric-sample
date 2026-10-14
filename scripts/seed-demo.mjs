import sharp from "sharp";
const base = "http://127.0.0.1:3001/api";
const health = await (await fetch(`${base}/health`)).json();
if (health.searchMode !== "demo")
  throw new Error("演示种子只允许在 SEARCH_MODE=demo 下运行");
const fieldList = await (await fetch(`${base}/custom-fields`)).json();
for (const field of [
  { key: "composition", label: "成分", type: "text", sortOrder: 0 },
  { key: "weight", label: "克重 (g/㎡)", type: "number", sortOrder: 1 },
  { key: "width", label: "幅宽 (cm)", type: "number", sortOrder: 2 },
]) {
  if (!fieldList.some((existing) => existing.key === field.key)) {
    const r = await fetch(`${base}/custom-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(field),
    });
    if (!r.ok) throw new Error(await r.text());
  }
}
const samples = await (await fetch(`${base}/samples?pageSize=100`)).json();
const designs = [
  {
    code: "DEMO-001",
    name: "演示 · 亚麻素织",
    bg: "#cabea8",
    line: "#a99a7b",
    accent: "#e5dccb",
    composition: "亚麻 55% / 棉 45%",
    weight: 210,
    width: 145,
    type: "plain",
  },
  {
    code: "DEMO-002",
    name: "演示 · 靛蓝细格",
    bg: "#4b6678",
    line: "#31475a",
    accent: "#c1d1cc",
    composition: "棉 100%",
    weight: 180,
    width: 150,
    type: "check",
  },
  {
    code: "DEMO-003",
    name: "演示 · 草木人字纹",
    bg: "#84957d",
    line: "#596e52",
    accent: "#c2c9ad",
    composition: "棉 70% / 涤纶 30%",
    weight: 260,
    width: 148,
    type: "herringbone",
  },
];
for (const design of designs) {
  if (samples.items.some((sample) => sample.code === design.code)) continue;
  let detail = "";
  for (let x = 0; x < 640; x += 3)
    detail += `<path d="M${x} 0V480" stroke="${x % 9 ? design.line : design.accent}" opacity=".26"/>`;
  for (let y = 0; y < 480; y += 3)
    detail += `<path d="M0 ${y}H640" stroke="${design.accent}" opacity=".32"/>`;
  if (design.type === "check") {
    for (let x = 0; x < 640; x += 48)
      detail += `<path d="M${x} 0V480" stroke="${design.accent}" opacity=".45" stroke-width="5"/>`;
    for (let y = 0; y < 480; y += 48)
      detail += `<path d="M0 ${y}H640" stroke="${design.accent}" opacity=".45" stroke-width="5"/>`;
  }
  if (design.type === "herringbone")
    for (let y = -20; y < 500; y += 8)
      for (let x = 0; x < 640; x += 40)
        detail += `<path d="M${x} ${y}l20 20l20 -20" stroke="${design.line}" opacity=".42" fill="none" stroke-width="2"/>`;
  const image = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${design.bg}"/>${detail}</svg>`,
    ),
  )
    .png()
    .toBuffer();
  const body = new FormData();
  body.append(
    "data",
    JSON.stringify({
      code: design.code,
      name: design.name,
      attributes: {
        composition: design.composition,
        weight: design.weight,
        width: design.width,
      },
    }),
  );
  body.append("images", new Blob([image]), `${design.code}.png`);
  const r = await fetch(`${base}/samples`, { method: "POST", body });
  if (!r.ok) throw new Error(await r.text());
  console.log(`Created ${design.code}`);
}
