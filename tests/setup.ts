import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import type { TestProject } from "vitest/node";
import { createClient } from "@libsql/client/http";
import { hashPassword } from "../worker/password";

export default async function setup(project: TestProject) {
  const directory = await mkdtemp(join(tmpdir(), "deep-talker-tests-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address() as { port: number };
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  const url = `http://127.0.0.1:${address.port}`;
  const child = spawn(
    "sqld",
    ["--http-listen-addr", `127.0.0.1:${address.port}`, "--db-path", join(directory, "database")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    output += data.toString();
  });
  const cleanup = async () => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await rm(directory, { recursive: true });
  };
  try {
    // ローカルのテスト用DBが起動するまで待つ。
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`${url}/health`);
        if (response.ok) break;
      } catch (error) {
        if (attempt === 99) throw error;
      }
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const client = createClient({ url, authToken: "" });
    await client.executeMultiple(await readFile("db/schema.sql", "utf8"));
    client.close();
    project.provide("databaseUrl", url);
    project.provide("passwordHash", await hashPassword("test-password"));
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
