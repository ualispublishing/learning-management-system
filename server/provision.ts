import { readAuthConfig } from './config.ts';
import { AuthStore } from './store.ts';

// Operator-only CLI, never a public self-registration or role-assignment API.
process.umask(0o077);
try {
  const config = readAuthConfig(process.env);
  const [operation, userId, subject, name] = process.argv.slice(2);
  if (!userId || !['add', 'disable'].includes(operation ?? '') || (operation === 'add' && (!subject || !name))) {
    throw new Error('Invalid provisioning arguments.');
  }
  const store = new AuthStore(config.databasePath);
  try {
    if (operation === 'disable') store.disable(userId);
    else store.provision(config.issuer, subject, { id: userId, name, globalRole: 'user' });
  } finally { store.close(); }
  console.log('Identity operation completed. Course permissions must be assigned separately.');
} catch {
  console.error('Identity operation failed. Usage: npm run provision -- add <stable-user-id> <issuer-subject> <display-name>, or disable <stable-user-id>.');
  process.exitCode = 1;
}
