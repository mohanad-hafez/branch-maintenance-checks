const fs=require('node:fs'),crypto=require('node:crypto');
const {branchHousekeeping}=require('./branch-policy.cjs');
const repository=process.env.GITHUB_REPOSITORY;
if(repository!=='mohanad-hafez/branch-maintenance-checks')throw Error('Unexpected execution repository');
const configBytes=fs.readFileSync('.github/gpm-config.yml');
function list(key){let active=false,found=false;const rows=[];for(const line of configBytes.toString('utf8').split(/\r?\n/)){if(line===key+':'){active=true;found=true;continue;}if(active&&/^[a-z_]+:/.test(line))break;const m=active&&/^  - ([^\s#]+)\s*$/.exec(line);if(m)rows.push(m[1]);}if(!found)throw Error('Missing config '+key);return rows;}
const config={repos:list('repos'),excluded_repos:list('excluded_repos')};
if(!config.repos.length||config.repos.some(name=>!name.startsWith('mohanad-hafez/')))throw Error('Experimental config must target owned forks');
const report={phase:'live_fork_deterministic_replacement',original_agent_comparison:false,github_run_id:process.env.GITHUB_RUN_ID,github_sha:process.env.GITHUB_SHA,config_sha256:crypto.createHash('sha256').update(configBytes).digest('hex'),input:{now:new Date().toISOString(),run_id:process.env.GITHUB_RUN_ID,run_url:`https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,config,repositories:{}},requests:[]};
const save=()=>fs.writeFileSync('branch-maintenance-result.json',JSON.stringify(report,null,2)+'\n');
async function api(target,endpoint,method='GET',body){
 if(method!=='GET'&&target!==repository)throw Error('Write target outside experimental fork');
 const item={target,endpoint,method,status:'request_started'};report.requests.push(item);save();
 let response;try{response=await fetch(`https://api.github.com/repos/${target}/${endpoint}`,{method,headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}catch(e){item.status=method==='GET'?'read_failed':'delivery_uncertain';save();throw Error(item.status+' '+method+' '+endpoint);}
 const text=await response.text();item.status='received';item.http_status=response.status;item.response_sha256=crypto.createHash('sha256').update(text).digest('hex');save();
 if(!response.ok){if(method!=='GET'&&response.status>=500)item.status='delivery_uncertain';save();throw Error('GitHub HTTP'+response.status+' '+method+' '+endpoint);}
 return text?JSON.parse(text):null;
}
async function pages(target,endpoint){const rows=[];for(let page=1;;page++){const data=await api(target,endpoint+(endpoint.includes('?')?'&':'?')+`per_page=100&page=${page}`);rows.push(...data);if(data.length<100)return rows;}}
async function main(){
 for(const target of config.repos){
  if(config.excluded_repos.includes(target))continue;
  try{
   const metadata=await api(target,'');
   if(metadata.archived){report.input.repositories[target]={archived:true};continue;}
   const raw=await pages(target,'branches');const base=raw.find(b=>b.name===metadata.default_branch);if(!base)throw Error('Default branch missing');
   const state={default_branch:metadata.default_branch,archived:false,branches:[],default_sha:base.commit.sha};report.input.repositories[target]=state;
   for(const b of raw){
    const branch={name:b.name,sha:b.commit.sha};state.branches.push(branch);
    if(b.name===metadata.default_branch||['main','master','develop'].includes(b.name)||b.name.startsWith('release/'))continue;
    try{
     const commit=await api(target,'commits/'+b.commit.sha);branch.last_commit_at=commit.commit.committer.date;branch.author=commit.committer?.login||commit.commit.committer.name;
     const comparison=await api(target,`compare/${base.commit.sha}...${b.commit.sha}`);branch.merged=comparison.ahead_by===0;branch.behind=comparison.behind_by;
     branch.open_prs=(await pages(target,'pulls?state=open&head='+encodeURIComponent(target.split('/')[0]+':'+b.name))).map(p=>p.number);
    }catch(e){branch.read_error=e.message;}
    save();
   }
  }catch(e){report.input.repositories[target]={error:e.message};save();}
 }
 report.output=branchHousekeeping(report.input);report.status='collected';save();
 const action=report.output.actions[0];
 const labels=await pages(repository,'labels');
 if(!labels.some(l=>l.name.toLowerCase()==='gpm/report'))await api(repository,'labels','POST',{name:'gpm/report',color:'ededed'});
 const issue=await api(repository,'issues','POST',{title:action.title,body:action.body,labels:action.labels});
 report.created_issue={number:issue.number,url:issue.html_url};report.status='issue_created';save();
 const readback=await api(repository,'issues/'+issue.number);
 if(readback.title!==action.title||readback.body!==action.body)throw Error('Report readback mismatch');
 report.closed_older_reports=[];
 for(const older of await pages(repository,'issues?state=open')){
  if(older.number!==issue.number&&!older.pull_request&&older.title.startsWith('[Branch Cleanup] ')&&older.labels.some(l=>l.name==='gpm/report')){
   await api(repository,'issues/'+older.number,'PATCH',{state:'closed',state_reason:'completed'});report.closed_older_reports.push(older.number);save();
  }
 }
 report.readback_verified=true;report.status='complete';save();
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Report: ${issue.html_url}\n\nScanned ${report.output.counts.repositories} repositories; ${report.output.counts.merged} merged and ${report.output.counts.stale} stale branches. Read errors: ${report.output.errors.length}.\n`);
 console.log(JSON.stringify({issue:issue.html_url,counts:report.output.counts,errors:report.output.errors.length}));
}
main().catch(e=>{report.status='stopped_inspection_required';report.error=e.message;save();if(report.output)console.log(report.output.actions[0].body);console.error(e.message);process.exitCode=1});
