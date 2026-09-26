/**
 * @file      packages/provider-aws/src/bundle.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   BUILD stage for AWS: bundles <app>/src/lambda.ts (+ deps) into one ESM file and zips it as lambda.mjs.
 * @depends   esbuild, adm-zip, node:fs, node:path
 * @usedBy    ./provider.ts deploy()
 * @agentNotes Handler must be "lambda.handler" → file lambda.mjs exporting `handler`. The createRequire banner lets
 *             bundled CommonJS dependencies call require() inside an ESM bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { build } from 'esbuild';

export async function bundleLambda(sourceDir: string): Promise<{ zip: Buffer; bytes: number }> {
  const entry = path.join(sourceDir, 'src', 'lambda.ts');
  if (!fs.existsSync(entry)) {
    throw new Error(`Missing ${entry}. Generate deployment assets first (Bob skill deployment-asset-authoring, or pnpm demo:golden).`);
  }
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: 'lambda.mjs',
    write: false,
    minify: true,
    legalComments: 'none',
    banner: { js: "import { createRequire as __bobopsCreateRequire } from 'module'; const require = __bobopsCreateRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output');
  const zip = new AdmZip();
  zip.addFile('lambda.mjs', Buffer.from(file.contents));
  const buffer = zip.toBuffer();
  return { zip: buffer, bytes: buffer.length };
}
