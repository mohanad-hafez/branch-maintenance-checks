const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const tasks = require('./tasks.cjs');
const file = process.argv[2];
const raw = fs.readFileSync(file);
const suite = JSON.parse(raw);
const results = [];
for (const record of suite.cases) {
  const started = process.hrtime.bigint();
  let output, error;
  try {
    output = tasks[suite.task](record.input);
    const expected = record.expected;
    if (expected.failure_kinds) assert.deepEqual(output.failures.map(f => f.failure_kind), expected.failure_kinds);
    if (expected.log_read_count !== undefined) assert.equal(output.log_reads.length, expected.log_read_count);
    if (expected.capped !== undefined) assert.equal(output.capped, expected.capped);
    if (expected.reason) assert.equal(output.failures[0].reason, expected.reason);
    if (expected.files) assert.deepEqual(output.actions[0].files, expected.files);
    if (expected.branch_categories) assert.deepEqual(output.findings.map(f => [f.repository, f.branch, f.category]).sort(), [...expected.branch_categories].sort());
    if (expected.actions) assert.deepEqual(output.actions, expected.actions);
    if (expected.action_kinds) assert.deepEqual(output.actions.map(action => action.kind), expected.action_kinds);
    if (expected.pr_targets) assert.deepEqual(output.actions.map(action => action.pull_request_number ?? action.item_number), expected.pr_targets);
    if (expected.affected_issues) assert.deepEqual([...new Set(output.actions.map(action => action.issue))], expected.affected_issues);
    if (expected.action_count !== undefined) assert.equal(output.actions.length, expected.action_count);
    if (expected.counts) assert.deepEqual(output.counts, expected.counts);
    if (expected.nanos !== undefined) assert.equal(output.totals?.nanos ?? null, expected.nanos);
    if (expected.formatted) assert.equal(output.totals.formatted, expected.formatted);
    if (expected.models) assert.equal(output.totals.models, expected.models);
    if (expected.first_kind) assert.equal(output.actions[0].kind, expected.first_kind);
    if (expected.target_issue) assert.equal(output.actions[0].issue, expected.target_issue);
    for (const text of expected.body_contains || []) assert.ok(output.actions[0].body.includes(text), 'Missing report content ' + text);
  } catch (failure) { error = String(failure); }
  results.push({ id: record.id, partition: record.partition, success: !error, elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6, error, output });
}
const summary = {
  example: suite.id, task: suite.task, phase: 'source_bound_contract_validation', paired_comparison: false,
  case_count: results.length, passed: results.filter(result => result.success).length,
  cases_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  implementation_sha256: crypto.createHash('sha256').update(fs.readFileSync(require.resolve('./tasks.cjs'))).digest('hex'),
  agent_baseline: 'not_run', model_calls: 0, results,
  github_run_id: process.env.GITHUB_RUN_ID || null, github_sha: process.env.GITHUB_SHA || null,
  platform: process.platform, node: process.version,
};
const output = process.argv[3] || 'results.json';
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ example: suite.id, passed: summary.passed, total: summary.case_count, phase: summary.phase, paired_comparison: false }));
if (summary.passed !== summary.case_count) process.exitCode = 1;
