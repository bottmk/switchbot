// Shared helper for workflow scripts: post the captured log either as a
// comment on the open tracker PR for the current branch, or fall back to
// creating a fresh Issue if no such PR exists.
const fs = require('node:fs');

module.exports = async ({ github, context, core, logPath, kind }) => {
  let body = '(no log captured)';
  try { body = fs.readFileSync(logPath, 'utf8'); } catch {}
  const MAX = 60000;
  if (body.length > MAX) body = body.slice(0, MAX) + '\n\n... (truncated)';
  const wrapped = '```\n' + body + '\n```';
  const branch = context.ref.replace('refs/heads/', '');
  const status = (typeof core !== 'undefined' && core.getInput) ? '' : '';
  const title = `[${kind}] run #${context.runNumber} on ${branch}`;

  const prs = await github.rest.pulls.list({
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: 'open',
    head: `${context.repo.owner}:${branch}`,
    per_page: 1,
  });

  if (prs.data.length > 0) {
    const prNumber = prs.data[0].number;
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: `### ${title}\n\n${wrapped}`,
    });
    console.log(`Posted comment to PR #${prNumber}`);
    if (core && core.summary) {
      core.summary
        .addHeading(`${kind} report posted`)
        .addLink(`PR #${prNumber} comment`, `${prs.data[0].html_url}#issuecomment-latest`)
        .write();
    }
    return { kind: 'pr_comment', number: prNumber };
  }

  const issue = await github.rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title,
    body: wrapped,
  });
  console.log(`No tracker PR found; created issue #${issue.data.number}`);
  if (core && core.summary) {
    core.summary
      .addHeading(`${kind} report posted`)
      .addLink(`Issue #${issue.data.number}`, issue.data.html_url)
      .write();
  }
  return { kind: 'issue', number: issue.data.number };
};
