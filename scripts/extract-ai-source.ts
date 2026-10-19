import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { extractTextFile } from '../src/lib/ai/textExtraction.server';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run ai:extract -- --input <source.txt|md|vtt|srt> --out <new-file.json> [--mime-type <type>]\nLocal extraction only. Does not call an AI provider or overwrite an existing output.');
    return;
  }
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]; const value = args[i + 1];
    if (!['--input', '--out', '--mime-type'].includes(name) || !value || value.startsWith('--') || values.has(name)) throw new Error('Invalid arguments. Run npm run ai:extract -- --help.');
    values.set(name, value);
  }
  if (!values.has('--input') || !values.has('--out')) throw new Error('Both --input and --out are required.');
  const inputPath = path.resolve(values.get('--input')!);
  const outputPath = path.resolve(values.get('--out')!);
  if (inputPath === outputPath) throw new Error('Output must be a new file, separate from the source.');
  const extracted = await extractTextFile(inputPath, { mimeType: values.get('--mime-type') });
  const output = await open(outputPath, 'wx', 0o600);
  try {
    await output.writeFile(`${JSON.stringify(extracted, null, 2)}\n`, 'utf8');
    await output.sync();
  } catch (error) {
    await output.close();
    await unlink(outputPath);
    throw error;
  }
  await output.close();
  console.log(`Extracted ${extracted.extraction.format.toUpperCase()}: ${extracted.source.segments.length} located passages, ${extracted.extraction.warnings.length} review notices. Saved locally; no AI call was made.`);
}

void main().catch(error => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') console.error('Output already exists; choose a new output path.');
  else console.error(error instanceof Error ? error.message : 'Source extraction failed.');
  process.exitCode = 1;
});
