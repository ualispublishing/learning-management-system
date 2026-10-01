import { readAuthConfig, readGatewayConfig } from './config.ts';
import { AuthStore } from './store.ts';
import { GatewayStore } from './gateway-store.ts';

process.umask(0o077);
let auth: AuthStore | undefined;
let gateway: GatewayStore | undefined;
try {
  const config = readAuthConfig(process.env);
  const institution = readGatewayConfig(process.env);
  if (!institution) throw new Error('Institution configuration required.');
  auth = new AuthStore(config.databasePath);
  gateway = new GatewayStore(config.databasePath, institution);
  const [command, ...args] = process.argv.slice(2);
  if (command === 'course' && args.length === 4 && args.slice(2).every(value => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))) gateway.provisionCourse(args[0], args[1], Date.parse(args[2]), Date.parse(args[3]));
  else if (command === 'enroll' && args.length === 3 && ['teacher', 'ta', 'student', 'remove'].includes(args[2])) {
    gateway.enroll(args[0], args[1], args[2] as 'teacher' | 'ta' | 'student' | 'remove');
  } else throw new Error('Invalid command.');
  console.log('Institution provisioning change committed.');
} catch {
  console.error('Provisioning failed. Check configuration, existing identities, course IDs and command arguments. Usage: course <id> <title> <term-start-ISO> <term-end-ISO> | enroll <course-id> <user-id> <teacher|ta|student|remove>');
  process.exitCode = 1;
} finally { gateway?.close(); auth?.close(); }
