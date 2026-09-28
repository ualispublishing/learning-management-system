'use strict';

const ALLOWED_ADVISORIES = Object.freeze({
  'GHSA-5P2G-FCMC-QVQQ': 'image-size',
  'GHSA-W3RX-R6R6-PGPR': 'image-size',
});

const severityRank = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});

const normalizeSeverity = value => typeof value === 'string' && value.toLowerCase() in severityRank
  ? value.toLowerCase()
  : 'unknown';

const advisoryId = advisory => {
  const searchable = [advisory?.url, advisory?.title, advisory?.source]
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
  const match = searchable.match(/GHSA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/i);
  if (match) return match[0].toUpperCase();
  if (typeof advisory?.source === 'number' || typeof advisory?.source === 'string') {
    return `NPM-${String(advisory.source).toUpperCase()}`;
  }
  return undefined;
};

const evaluateAuditReport = report => {
  const failures = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, failures: ['npm audit did not return an object.'], allowedAdvisories: [], vulnerabilityCount: 0 };
  }

  const vulnerabilities = report.vulnerabilities;
  const counts = report.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)
    || !counts || typeof counts !== 'object' || Array.isArray(counts)) {
    return { ok: false, failures: ['npm audit did not return the expected v2 vulnerability report.'], allowedAdvisories: [], vulnerabilityCount: 0 };
  }

  const vulnerabilityNames = Object.keys(vulnerabilities);
  const allowed = new Set();
  const unexpected = new Set();
  const unresolved = new Set();
  let foundCritical = Number(counts.critical) > 0;

  const resolve = (name, stack = new Set()) => {
    if (stack.has(name)) {
      // npm's v2 report can contain legitimate dependency cycles (Metro is one
      // example). A back-edge is not itself an unresolved advisory root. The
      // caller still has to reach at least one concrete advisory through this
      // or another branch, so a cycle with no advisory remains fail-closed.
      return false;
    }
    const vulnerability = vulnerabilities[name];
    if (!vulnerability || typeof vulnerability !== 'object' || !Array.isArray(vulnerability.via)) {
      unresolved.add(name);
      return false;
    }
    if (normalizeSeverity(vulnerability.severity) === 'critical') foundCritical = true;
    if (vulnerability.via.length === 0) {
      unresolved.add(name);
      return false;
    }
    const nextStack = new Set(stack).add(name);
    let reachedAdvisory = false;
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        if (resolve(via, nextStack)) reachedAdvisory = true;
        continue;
      }
      if (!via || typeof via !== 'object' || Array.isArray(via)) {
        unresolved.add(`${name}: malformed advisory`);
        continue;
      }
      if (normalizeSeverity(via.severity) === 'critical') foundCritical = true;
      const id = advisoryId(via);
      const affectedPackage = typeof via.name === 'string'
        ? via.name
        : typeof via.dependency === 'string'
          ? via.dependency
          : name;
      if (!id) {
        unresolved.add(`${name}: advisory without a stable identifier`);
      } else if (ALLOWED_ADVISORIES[id] === affectedPackage) {
        allowed.add(id);
        reachedAdvisory = true;
      } else {
        unexpected.add(`${id} (${affectedPackage})`);
        reachedAdvisory = true;
      }
    }
    return reachedAdvisory;
  };

  for (const name of vulnerabilityNames) {
    if (!resolve(name)) unresolved.add(name);
  }

  const reportedTotal = Number(counts.total);
  if (!Number.isInteger(reportedTotal) || reportedTotal < 0) failures.push('npm audit reported an invalid vulnerability total.');
  else if (reportedTotal !== vulnerabilityNames.length) failures.push(`npm audit reported ${reportedTotal} vulnerabilities but supplied ${vulnerabilityNames.length} entries.`);
  if (foundCritical) failures.push('At least one critical vulnerability is present; critical findings are never allowlisted.');
  if (unexpected.size) failures.push(`Unapproved advisory roots: ${[...unexpected].sort().join(', ')}.`);
  if (unresolved.size) failures.push(`Vulnerability roots could not be resolved: ${[...unresolved].sort().join(', ')}.`);

  return {
    ok: failures.length === 0,
    failures,
    allowedAdvisories: [...allowed].sort(),
    vulnerabilityCount: vulnerabilityNames.length,
  };
};

module.exports = {
  ALLOWED_ADVISORIES,
  evaluateAuditReport,
};
