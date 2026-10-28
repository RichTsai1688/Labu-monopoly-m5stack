import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!existsSync(root + "dist/index.html")) {
  console.error("請先執行 npm run build");
  process.exit(1);
}
const children = [];
function run(script, args) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`本機服務結束 (${code})`);
      stop(code ?? 0);
    }
  });
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
process.on("SIGHUP", () => stop());
run(root + "node_modules/tsx/dist/cli.mjs", ["server/room-server.ts"]);
run(root + "node_modules/vite/bin/vite.js", [
  "preview",
  "--host",
  "127.0.0.1",
  "--port",
  "4173",
  "--strictPort",
]);
console.log(
  "\n🎲 玩具城市：http://127.0.0.1:4173\n本機同桌、NPC 與本機連線房間皆可使用；Ctrl+C 結束。\n",
);
