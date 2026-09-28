import {
  DEFAULT_SHARED_DEMO_HOST,
  DEFAULT_SHARED_DEMO_PORT,
  DEFAULT_SHARED_DEMO_RESET_KEY,
  listenSharedDemoServer,
} from '../src/lib/testing/sharedDemoServer';

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('LMS_DEMO_SERVER_PORT must be a whole number from 1 to 65535.');
  }
  return parsed;
};

const host = DEFAULT_SHARED_DEMO_HOST;
const port = parsePort(process.env.LMS_DEMO_SERVER_PORT, DEFAULT_SHARED_DEMO_PORT);
const resetKey = process.env.LMS_DEMO_RESET_KEY?.trim() || DEFAULT_SHARED_DEMO_RESET_KEY;

const main = async () => {
  const server = await listenSharedDemoServer({ host, port, resetKey });
  console.log(`Shared LMS demo server ready at http://${host}:${port}`);
  console.log('Loopback-only, in-memory test data. Press Ctrl+C to stop and erase the session.');

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'The shared demo server could not start.');
  process.exitCode = 1;
});
