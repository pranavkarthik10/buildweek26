import { promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/db";
import { deleteObject, isObjectStorageConfigured } from "@/lib/object-storage";

const apply = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.$queryRaw<Array<{ id: string; jobKey: string }>>`SELECT "id", "jobKey" FROM "Artifact" WHERE "engine" = 'hyperframes'`;
  console.log(`${apply ? "Applying" : "Dry run:"} ${rows.length} legacy visual artifact cleanup(s).`);
  for (const row of rows) {
    const files = [
      path.join(process.cwd(), "public", "generated-artifacts", `${row.jobKey}.mp4`),
      path.join(process.cwd(), "public", "generated-artifacts", `${row.jobKey}.html`),
      path.join(process.cwd(), "public", "generated-artifacts", `${row.jobKey}.preview.html`),
    ];
    console.log(`- ${row.id} ${row.jobKey}`);
    if (!apply) continue;
    for (const file of files) await fs.rm(file, { force: true }).catch(() => undefined);
    if (isObjectStorageConfigured()) {
      for (const suffix of [".mp4", ".audio.mp3", ".audio.wav", ".html", ".preview.html"]) {
        await deleteObject(`artifacts/${row.jobKey}${suffix}`).catch(() => undefined);
      }
    }
    await prisma.$executeRaw`DELETE FROM "Artifact" WHERE "id" = ${row.id}`;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
