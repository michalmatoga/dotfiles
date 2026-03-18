You are reviewing a pull request for [org/repo] at [pr-url].
Use the prefetched upstream context below as the baseline.
Do not re-fetch PR metadata unless the prefetched context is missing critical information.

First, help me understand the PR before critique, using 3-5 bullets for each section:
1) Purpose and scope (problem solved and intended outcome).
2) How it works in code (key files, control flow, and integration points).
3) Behavioral impact (what changes for users/systems and important invariants).

Then perform the review:
Compare the PR branch to main and focus on correctness, security, and maintainability.
Highlight high-risk changes, missing tests, and any backward-compatibility concerns.
Summarize the review in 5-8 bullets with concrete follow-ups.
If you need more context, list exactly what to inspect or run.
Prepare inline comments for PR.

[prefetched-context]

## Adding inline comments

Add inline comments to PR #<num> using gh.

Requirements:

- Create one pending review that contains all inline comments (GitHub allows only one pending review per user).
- Anchor comments to diff lines only. Use gh pr diff <num> --patch to find the exact RIGHT-side line positions in the diff hunk.
- If a desired comment line isn't present in the diff, attach it to the nearest changed line in that same hunk.
- Use gh pr view <num> --json commits and the latest commit SHA as commit_id.
- Use gh api -X POST /repos/<org>/<repo>/pulls/<num>/reviews with a single comments array payload.
- After posting, fetch /reviews/<id>/comments and report the review URL.

This keeps line anchors valid and avoids the one pending review limitation.
