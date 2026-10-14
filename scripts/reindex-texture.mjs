// Migrate all active image indexes through the API; reruns skip completed records.
const base = process.env.REINDEX_API_URL || "http://127.0.0.1:3001/api";
async function request(path, init) {
  const response = await fetch(base + path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data;
}
const health = await request("/health");
if (health.searchProfile !== "texture-gray-v1")
  throw new Error("Start the updated backend before migrating");
const images = [];
for (let page = 1; ; page++) {
  const result = await request(`/samples?page=${page}&pageSize=100`);
  for (const sample of result.items)
    for (const image of sample.images)
      images.push({ ...image, code: sample.code });
  if (page * 100 >= result.total) break;
}
let migrated = 0,
  failed = 0;
for (const image of images) {
  if (
    image.indexStatus === "indexed" &&
    image.indexProfile === health.searchProfile &&
    image.indexMode === health.searchMode
  )
    continue;
  const result = await request(`/images/${image.id}/retry-index`, {
    method: "POST",
  });
  if (result.indexStatus === "indexed") migrated++;
  else failed++;
  console.log(
    `${image.code}: ${result.indexStatus}${result.lastError ? ` (${result.lastError})` : ""}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 650));
}
console.log(
  `Images: ${images.length}, migrated: ${migrated}, failed: ${failed}`,
);
if (failed) process.exitCode = 1;
