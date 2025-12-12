const { execSync } = require("child_process");
const simpleGit = require("simple-git");
const { v4: uuid } = require("uuid");
const fs = require("fs");

function runSemgrep(isPro, repoDir) {
  const config = isPro ? "auto" : "p/ci";
  const env = { ...process.env };
  
  // SEMGREP_APP_TOKEN is already in process.env if Pro mode
  // No need to conditionally add it
  
  try {
    const output = execSync(`semgrep ci --config ${config} --json`, {
      cwd: repoDir,
      encoding: "utf-8",
      env: env
    });
    return { success: true, results: JSON.parse(output) };
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : "";
    const parsed = stdout.trim().startsWith("{") || stdout.trim().startsWith("[")
      ? JSON.parse(stdout) : null;
    return { success: false, results: parsed };
  }
}

function shouldRunProMode() {
  // Run Pro mode if SEMGREP_APP_TOKEN is present
  return !!process.env.SEMGREP_APP_TOKEN;
}

module.exports = (app) => {
  app.on("pull_request", async (context) => {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const sha = context.payload.pull_request.head.sha;
    const branch = context.payload.pull_request.head.ref;
    let checkRunId = null;

    try {
      const check = await context.octokit.checks.create({
        owner, repo, name: "Semgrep", head_sha: sha, status: "in_progress"
      });
      checkRunId = check.data.id;

      const { data: { token } } =
        await context.octokit.apps.createInstallationAccessToken({
          installation_id: context.payload.installation.id
        });

      const repoDir = `/tmp/${uuid()}`;
      const cloneUrl = context.payload.repository.clone_url.replace(
        "https://", `https://x-access-token:${token}@`
      );

      await simpleGit().clone(cloneUrl, repoDir, [
        "--depth", "1", "--branch", branch
      ]);

      const isPro = shouldRunProMode();
      const result = runSemgrep(isPro, repoDir);

      const findings = result?.results?.results || [];
      const annotations = findings.slice(0, 50).map((f) => ({
        path: f.path, start_line: f.start.line, end_line: f.end.line,
        annotation_level: "failure",
        message: `[${f.check_id}] ${f.extra.message}`
      }));

      await context.octokit.checks.update({
        owner, repo, check_run_id: checkRunId,
        status: "completed",
        conclusion: result.success ? "success" : "failure",
        output: {
          title: isPro ? "Semgrep Pro Scan" : "Semgrep OSS Scan",
          summary: isPro ? "Semgrep Pro ran." : "Semgrep OSS ran.",
          annotations
        }
      });
      
      // Clean up temporary directory
      try {
        fs.rmSync(repoDir, { recursive: true, force: true });
      } catch {}

    } catch (e) {
      const msg = e.message || "Unexpected error running Semgrep.";
      
      // Update existing check if we have the ID, otherwise create new one
      if (checkRunId) {
        await context.octokit.checks.update({
          owner, repo, check_run_id: checkRunId,
          status: "completed", conclusion: "failure",
          output: { title: "Semgrep failed", summary: msg }
        });
      } else {
        await context.octokit.checks.create({
          owner, repo, name: "Semgrep", head_sha: sha,
          status: "completed", conclusion: "failure",
          output: { title: "Semgrep failed", summary: msg }
        });
      }
    }
  });
};
