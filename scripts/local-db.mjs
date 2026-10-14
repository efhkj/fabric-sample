import EmbeddedPostgres from "embedded-postgres";
import { resolve } from "node:path";
const db = new EmbeddedPostgres({
  databaseDir: resolve(".local-postgres"),
  user: "fabric",
  password: "fabric_local",
  port: 5432,
  persistent: true,
});
await db.initialise();
await db.start();
try {
  await db.createDatabase("fabric_sample");
} catch (error) {
  if (!String(error).includes("already exists")) {
    await db.stop();
    throw error;
  }
}
console.log(
  "本地 PostgreSQL 已启动（127.0.0.1:5432）。保留此终端；Ctrl+C 停止，数据保留。",
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await db.stop();
    process.exit(0);
  });
setInterval(() => {}, 60000);
