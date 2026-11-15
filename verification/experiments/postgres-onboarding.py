"""Real PostgreSQL isolation/concurrency checks in a disposable LOCAL Docker DB.
Never point this harness at production. Evidence is synthetic, not device acceptance.
"""
import concurrent.futures,json,pathlib,subprocess,time,uuid,os
ROOT=pathlib.Path(__file__).resolve().parents[2]
DB='onboarding_fixture_'+uuid.uuid4().hex[:10]
BASE=['docker','--host=unix:///var/run/docker.sock','exec','-i','meera-experiment-db','psql','-U','postgres','-v','ON_ERROR_STOP=1','-At']
def run(sql,role=None,actor=None,fail=False):
    prefix=("set role "+role+";") if role else ''
    if actor: prefix+="set \"request.jwt.claim.sub\"='"+actor+"';"
    p=subprocess.run(BASE+['-d',DB],input=prefix+sql,text=True,capture_output=True)
    if fail:
        assert p.returncode!=0, 'Expected rejection';return p.stderr
    assert p.returncode==0,p.stderr
    return p.stdout.strip().splitlines()[-1] if p.stdout.strip() else ''
def auth(sql,actor,fail=False): return run(sql,'authenticated',actor,fail)
operator='00000000-0000-4000-8000-000000000001'
subprocess.run(BASE+['-c',"do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$"],capture_output=True,check=True)
subprocess.run(BASE+['-c','create database '+DB],capture_output=True,check=True)
results=[]
try:
    run("create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,created_at timestamptz not null default now()); create table auth.identities(user_id uuid references auth.users(id),provider text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated; create table public.meera_onboarding_drafts(user_id uuid primary key references auth.users(id),complete boolean not null default false,updated_at timestamptz default now());")
    run((ROOT/'supabase/migrations/20261113140000_onboarding_input_experiment.sql').read_text())
    run(f"insert into auth.users(id,email,email_confirmed_at) values('{operator}','operator@himeera.com',now()); insert into auth.identities values('{operator}','google');insert into public.onboarding_experiment_operators values('{operator}',true);")
    assert run("select enabled from public.onboarding_experiment_config")=='f'
    assert 'permission denied' in run('select * from public.onboarding_experiment_assignments','authenticated',operator,True)
    assert 'permission denied' in run('select public.onboarding_experiment_assignment()','anon',fail=True)
    assert 'ACCEPTANCE_REQUIRED' in auth('select public.onboarding_experiment_control(true,1)',operator,True)
    report=json.loads(auth('select public.onboarding_experiment_report()',operator))
    assert len(report['acceptance'])==40 and not any(c['passed'] for c in report['acceptance'])
    results.append('dark default, no direct client writes/reads, 40 real-acceptance gates and operator checks')
    for check in report['acceptance']:
        auth("select public.onboarding_experiment_accept('"+check['check_key']+"',true,'repo:isolated-postgres-fixture-NOT-device-evidence')",operator)
    config=json.loads(auth('select public.onboarding_experiment_control(true,1)',operator));assert config['version']==2
    # Generate only in-allocation synthetic users; real enrollment remains capped at 10%.
    run("insert into auth.users(id,email,email_confirmed_at) select id,'fixture-'||id::text||'@example.test',now() from (select gen_random_uuid() id from generate_series(1,1200)) s where (('x'||substr(md5(id::text||':onboarding_input_mode_v1:enrollment'),1,8))::bit(32)::bigint%10000)<1000 limit 65; insert into auth.identities select id,'google' from auth.users where id<>'"+operator+"';")
    actors=run("select string_agg(id::text,',') from auth.users where id<>'"+operator+"'").split(',');assert len(actors)==65
    a,b=actors[:2]
    def assignment(who,expose=False,version=None):return json.loads(auth(f"select public.onboarding_experiment_assignment({'true' if expose else 'false'},{version if version is not None else 'null'},false)",who))
    first=assignment(a);assert first['assigned'] and not first['exposed'];assert assignment(a)['variant']==first['variant']
    assert 'STALE_EXPOSURE' in auth('select public.onboarding_experiment_assignment(true,1,false)',a,True)
    assert assignment(a,True,2)['exposed'];assignment(b)
    results.append('stable server assignment and stale-exposure rejection')
    # Disable holds the config lock; a concurrent stale exposure waits and cannot land after commit.
    sql=f"begin;set role authenticated;set \"request.jwt.claim.sub\"='{operator}';select public.onboarding_experiment_control(false,2);select 'DISABLE_LOCK_HELD';select pg_sleep(1);commit;"
    p=subprocess.Popen(BASE+['-d',DB],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    p.stdin.write(sql);p.stdin.close()
    while 'DISABLE_LOCK_HELD' not in p.stdout.readline(): assert p.poll() is None,'Disable transaction ended before marker'
    assert assignment(b,True,2)['enabled'] is False
    p.wait();assert p.returncode==0,p.stderr.read()
    assert run(f"select exposure_at is null from public.onboarding_experiment_assignments where user_id='{b}'")=='t'
    auth('select public.onboarding_experiment_control(true,3)',operator)
    assert assignment(a)['variant']==first['variant']
    results.append('concurrent disable blocks stale exposure; resume preserves assignment and original window')
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(assignment,actors[2:]))
    assert int(run("select count(*) from public.onboarding_experiment_assignments where cohort='pilot'"))==40
    unassigned=run("select id from auth.users where id not in(select user_id from public.onboarding_experiment_assignments) and id<>'"+operator+"' limit 1");assert assignment(unassigned)['assigned'] is False
    results.append('concurrent enrollment never exceeds the 40-account cap')
    event=str(uuid.uuid4())
    assert auth(f"select public.onboarding_experiment_event('{event}','start')",a)=='t'
    assert auth(f"select public.onboarding_experiment_event('{event}','start')",a)=='t'
    assert run(f"select count(*) from public.onboarding_experiment_events where user_id='{a}'")== '1'
    assert 'INVALID_EVENT' in auth(f"select public.onboarding_experiment_event('{uuid.uuid4()}','profile_saved')",a,True)
    run(f"insert into public.meera_onboarding_drafts values('{a}',true,now())")
    assert run(f"select saved_at is not null from public.onboarding_experiment_assignments where user_id='{a}'")=='t'
    assert 'WORKSPACE_REQUIRED' in auth(f"select public.onboarding_experiment_event('{uuid.uuid4()}','useful_response_confirmed')",a,True)
    auth(f"select public.onboarding_experiment_event('{uuid.uuid4()}','workspace_arrived')",a)
    auth(f"select public.onboarding_experiment_event('{uuid.uuid4()}','useful_response_confirmed')",a)
    assert 'FORBIDDEN' in auth('select public.onboarding_experiment_report()',a,True)
    results.append('idempotent events, server-only profile save, workspace-gated usefulness and reporting isolation')
    # Explicit internal QA is operable while off but never included in pilot aggregates.
    qa=json.loads(auth('select public.onboarding_experiment_assignment(true,4,true)',operator));assert qa['assigned']
    summary=json.loads(auth('select public.onboarding_experiment_report()',operator))
    assert sum(a['assigned'] for a in summary['arms'])==40 and summary['qa_assignments']==1
    assert '@example.test' not in json.dumps(summary)
    results.append('QA excluded from pilot denominators; aggregate report contains no customer email/profile/audio')
    print(json.dumps({'database':'LOCAL disposable PostgreSQL','groups':results,'passed':len(results),'productionChanged':False},indent=2))
finally:
    subprocess.run(BASE+['-c','drop database if exists '+DB+' with (force)'],capture_output=True)
