import process from 'node:process';

const port = process.env.LMS_DEMO_SERVER_PORT || '4180';
const resetKey = process.env.LMS_DEMO_RESET_KEY || 'local-shared-demo-reset';
const response = await fetch(`http://127.0.0.1:${port}/reset`, {
  method: 'POST',
  headers: { 'x-demo-reset-key': resetKey },
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(payload.error || `Shared demo reset failed (${response.status}).`);
console.log('Shared LMS demo data reset. Reload both browser sessions before starting the next journey.');
