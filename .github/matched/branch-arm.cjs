const fs=require('node:fs');
const assert=require('node:assert/strict');
const {branchHousekeeping}=require('./branch-policy.cjs');
const {inputs}=JSON.parse(fs.readFileSync('branch.json','utf8'));
const {input,report}=JSON.parse(fs.readFileSync('branch-oracle.json','utf8'));
assert.deepEqual(inputs.config,input.config);
assert.deepEqual(inputs.repositories,input.repositories);
assert.equal(inputs.clock,input.now);
const result=branchHousekeeping(input);
assert.deepEqual(result.errors,[]);
const output={
  counts:result.counts,
  findings:result.findings.map(({repository,branch,category,last_commit_at,author,behind,open_prs})=>
    ({repository,branch,category,last_commit_at,author,behind,open_prs})),
};
if(process.env.ARM==='agent'){
  const calls=fs.readFileSync('evidence/tools.jsonl','utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(row=>!row.error));
  assert.deepEqual([...new Set(calls.slice(0,-1).map(row=>row.args.name))].sort(),Object.keys(inputs).sort());
  assert.equal(calls.at(-1).name,'publish_result');
  const submitted=JSON.parse(calls.at(-1).args.body);
  assert.deepEqual(submitted,output);
}
fs.writeFileSync('evidence/decision.json',JSON.stringify(output));
fs.writeFileSync('evidence/result.json',JSON.stringify(report));
