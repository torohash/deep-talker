import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createClient } from "@libsql/client/http";
import { hashPassword, newToken } from "../worker/password";

const command = process.argv[2];
if (command === "hash-password") {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    console.log(await hashPassword(await terminal.question("パスワード: ")));
  } finally {
    terminal.close();
  }
} else {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  try {
    if (command === "migrate") {
      await client.executeMultiple(await readFile("db/schema.sql", "utf8"));
      console.log("スキーマを適用しました。");
    } else if (command === "apply") {
      await client.executeMultiple(await readFile(process.argv[3], "utf8"));
      console.log("SQLを適用しました。");
    } else if (command === "seed-demo") {
      for (const [index, name] of ["ハル", "アオイ", "ユウ", "ナナ"].entries()) {
        const id = `member-${index + 1}`;
        const password = newToken();
        await client.execute({
          sql: "INSERT INTO users (id, name, password_hash) VALUES (?, ?, ?)",
          args: [id, name, await hashPassword(password)],
        });
        console.log(`${id}\t${name}\t${password}`);
      }
      await client.executeMultiple(await readFile("db/topics.example.sql", "utf8"));
      console.log("デモ用データを登録しました。パスワードはこの表示から控えてください。");
    } else {
      throw new Error(
        "使い方: bun run db migrate | apply <SQLファイル> | hash-password | seed-demo",
      );
    }
  } finally {
    client.close();
  }
}
