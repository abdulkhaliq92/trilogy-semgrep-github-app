# Semgrep GitHub App - Implementation Update

## What's Been Implemented

- **GitHub App on AWS Lambda** - Serverless, auto-scaling, Docker-based
- **Organization-wide coverage** - Single installation for large number of repos, no per-repo setup
- **GitHub Checks API** - Blocks PR merging on findings, inline annotations
- **Dual modes** - OSS by default, Pro with `SEMGREP_APP_TOKEN`
- **Automatic scanning** - Triggers on PR open/push/reopen
- **Capacity** - Handles 300k scans/day (30k repos × 10 PRs/day)

## What Still Needs to Be Done

### Handling Lambda Timeout (Current: 2min, Max: 15min)

#### Solution 1: Incremental Scanning (Recommended)
Scan only changed files in PR - reduces time by 90-95%
```javascript
const changedFiles = await getChangedFiles(context, owner, repo, prNumber);
const fileArgs = changedFiles.map(f => `--include=${f}`).join(' ');
execSync(`semgrep ci --config ${config} --json ${fileArgs}`);
```

#### Solution 2: AWS Step Functions
Split scan into chunks, run in parallel - handles any repo size

#### Solution 3: ECS Fargate
No time limits - for repos >500MB or 50k+ files

#### Solution 4: Smart Pre-checks
Fail fast if repo too large with instructions to run locally

### Security
1. Move private key to AWS Secrets Manager (currently in env vars)
2. Add 100s timeout to `execSync` (prevent hangs)
3. Pin versions: `semgrep==1.52.0`, `nodejs:18.2024.01.01`

### Monitoring
1. CloudWatch metrics: scan duration, findings count, success rate
2. Alerts: error rate >5%, duration p99 >110s, throttling
3. Runbook and rollback procedure

## Test Cases to Cover

**Repository Sizes**
- Small (<100 files): <30s completion
- Medium (1k-5k files): 30-60s completion
- Large (10k+ files): Graceful timeout handling
- Monorepos (50k+ files): Clear error message

**PR Scenarios**
- Fork PRs, draft PRs, concurrent PRs, rapid updates
- Vulnerable code (blocks merge), clean code (passes)

**Edge Cases**
- Empty repos, binary files, non-UTF8, invalid webhooks, missing credentials

## Rollout Plan

### Phase 1: Pilot (10 repos)
- Deploy to test account, run 50+ test PRs
- Success: 95% success rate, <60s avg scan time

### Phase 2: Limited (100 repos)
- Implement incremental scanning, add monitoring
- Success: 99% success rate, 1000 PRs/day

### Phase 3: Full (30k+ repos)
- Enable org-wide, add Step Functions for large repos
- Success: 10k+ PRs/day, <5% timeout rate

## Key Recommendations

**Immediate:**
- Implement incremental scanning (90% performance gain)
- Set developer expectations (monorepos may need local scanning)

**Next:**
- Build monitoring dashboard
- Add opt-out mechanism and manual re-scan trigger

**Future:**
- Hybrid architecture: Lambda (99% repos) + Step Functions (large) + ECS (giants)
