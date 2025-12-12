# Semgrep GitHub App — Organization-wide Security Scanning

**Automated Semgrep security scanning for 30,000+ repositories via GitHub App + AWS Lambda. Zero per-repo configuration.**

## Overview

GitHub App + AWS Lambda solution for organization-wide Semgrep scanning. Runs on every PR, blocks merge on security findings. No per-repo configuration needed.

**Architecture:** `PR Event → Webhook → Lambda → Semgrep → GitHub Check`

---

## GitHub App Setup

### Create GitHub App

1. Go to `https://github.com/organizations/YOUR_ORG/settings/apps` → **New GitHub App**
2. Configure:
   - **Name**: `Semgrep Security Scanner`
   - **Webhook URL**: Lambda Function URL (set after deployment)
   - **Webhook secret**: `openssl rand -hex 32` (save for Lambda)
3. **Permissions**: Contents (Read), Metadata (Read), Pull requests (Read), Checks (Read & Write)
4. **Events**: Pull request (all sub-events)
5. **Create** → Save **App ID** → Generate **Private Key** (download `.pem`)

### Install on Organization

1. App settings → **Install App** → Select organization
2. Choose **"All repositories"** (recommended)
3. Install → Note **Installation ID** from URL

---

## AWS Lambda Deployment

**Prerequisites:** AWS CLI, Docker, ECR access, GitHub App created

### Build and Push Image

```bash
# Set your AWS account ID and region
export AWS_ACCOUNT_ID=123456789012
export AWS_REGION=us-east-1
export ECR_REPO_NAME=semgrep-github-app

# Authenticate Docker to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Create ECR repository (first time only)
aws ecr create-repository \
  --repository-name $ECR_REPO_NAME \
  --region $AWS_REGION

# Build the Docker image
docker build -t $ECR_REPO_NAME:latest .

# Tag for ECR
docker tag $ECR_REPO_NAME:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest

# Push to ECR
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest
```

### Create IAM Role

```bash
# Create trust policy
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create IAM role
aws iam create-role \
  --role-name semgrep-github-app-lambda-role \
  --assume-role-policy-document file://trust-policy.json

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name semgrep-github-app-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### Create Lambda Function

```bash
# Get the IAM role ARN
export ROLE_ARN=$(aws iam get-role \
  --role-name semgrep-github-app-lambda-role \
  --query 'Role.Arn' --output text)

# Create Lambda function from container image
aws lambda create-function \
  --function-name semgrep-github-app \
  --package-type Image \
  --code ImageUri=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest \
  --role $ROLE_ARN \
  --timeout 120 \
  --memory-size 2048 \
  --ephemeral-storage Size=1024 \
  --region $AWS_REGION
```

### Set Environment Variables

```bash
# Prepare your GitHub App credentials
export GITHUB_APP_ID=123456  # From GitHub App settings
export GITHUB_WEBHOOK_SECRET=your_webhook_secret  # Generated during app creation
export GITHUB_PRIVATE_KEY=$(cat path/to/your-app.private-key.pem)  # Downloaded .pem file

# Optional: For Semgrep Pro mode
# export SEMGREP_APP_TOKEN=your_semgrep_token

# Set Lambda environment variables
aws lambda update-function-configuration \
  --function-name semgrep-github-app \
  --environment "Variables={
    APP_ID=$GITHUB_APP_ID,
    WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET,
    PRIVATE_KEY=$GITHUB_PRIVATE_KEY
  }" \
  --region $AWS_REGION

# If using Semgrep Pro, add SEMGREP_APP_TOKEN:
# aws lambda update-function-configuration \
#   --function-name semgrep-github-app \
#   --environment "Variables={
#     APP_ID=$GITHUB_APP_ID,
#     WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET,
#     PRIVATE_KEY=$GITHUB_PRIVATE_KEY,
#     SEMGREP_APP_TOKEN=$SEMGREP_APP_TOKEN
#   }" \
#   --region $AWS_REGION
```

### Create Function URL

```bash
# Create public function URL
aws lambda create-function-url-config \
  --function-name semgrep-github-app \
  --auth-type NONE \
  --region $AWS_REGION

# Get the function URL
aws lambda get-function-url-config \
  --function-name semgrep-github-app \
  --region $AWS_REGION \
  --query 'FunctionUrl' --output text

# Output example: https://abc123xyz.lambda-url.us-east-1.on.aws/
```

### Update GitHub Webhook

1. GitHub App settings → Webhook section
2. Set **Webhook URL** to Lambda Function URL
3. Save

**Lambda Config:** 2048 MB memory, 120s timeout, 1024 MB ephemeral storage

**Required Env Vars:** `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`  
**Optional:** `SEMGREP_APP_TOKEN` (enables Pro mode)

---

## Usage

### For Developers

**Automatic:** Semgrep runs on every PR (open, reopen, push). No action needed.

**Results:**
- ✓ Success: No issues, merge allowed
- ✗ Failure: Issues found, merge blocked
- Click check for inline annotations with remediation guidance

**Fix and re-scan:**
```bash
git add .
git commit -m "Fix security issues"
git push  # Automatically re-scans
```

### Scanning Modes

**OSS Mode (default):** Free community rules (`p/ci` config)  
**Pro Mode:** Add `SEMGREP_APP_TOKEN` to Lambda env vars for custom rules + Semgrep Cloud

### Monitoring

**CloudWatch Logs:**
```bash
aws logs tail /aws/lambda/semgrep-github-app --follow
```

**Semgrep Cloud:** Dashboard with aggregated findings (Pro mode only)

---

## Verification

1. GitHub App → Advanced → Recent Deliveries → Redeliver (verify 200 OK)
2. Create test PR with `eval()` usage → should trigger failure
3. Check CloudWatch: `aws logs tail /aws/lambda/semgrep-github-app --follow`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No webhook delivery | Check GitHub App → Webhook deliveries |
| 401/403 errors | Verify `WEBHOOK_SECRET` matches |
| No check appears | Verify Checks: Write permission |
| Timeouts | Increase Lambda timeout/memory |
| Errors | Check CloudWatch: `/aws/lambda/semgrep-github-app` | 

---

## Local Development

```bash
npm install
export APP_ID=your_app_id PRIVATE_KEY="$(cat private-key.pem)" WEBHOOK_SECRET=your_secret
npx probot run ./app.js

# Test container
docker build -t semgrep-github-app .
docker run -p 9000:8080 -e APP_ID=$APP_ID -e PRIVATE_KEY="$PRIVATE_KEY" -e WEBHOOK_SECRET=$WEBHOOK_SECRET semgrep-github-app
```

---

## Notes

**Cost:** ~$11/month for 9M requests (30k repos × 10 PRs/day)  
**Limitations:** Fork PRs not supported, large monorepos may need increased timeout

---

## Operations

### Updates
```bash
# Build, tag, push new version
docker build -t semgrep-github-app:v2.0.0 .
docker tag semgrep-github-app:v2.0.0 $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:v2.0.0
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:v2.0.0

# Update Lambda (zero downtime)
aws lambda update-function-code --function-name semgrep-github-app --image-uri $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:v2.0.0
```

### Rollback
```bash
# Revert to previous version (< 1 minute)
aws lambda update-function-code --function-name semgrep-github-app --image-uri $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:v1.9.0
```

### Monitoring
**CloudWatch Alarms:** Error rate > 5%, Duration p99 > 110s, Throttles > 0  
**Logs:** `/aws/lambda/semgrep-github-app`

---

**Run locally:** `pip install semgrep && semgrep --config p/ci .`
