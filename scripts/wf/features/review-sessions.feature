Feature: Review request workspace and sessions
  The workflow prepares local worktrees and spawns review sessions.

  Background:
    Given the GitHub Enterprise host is "schibsted.ghe.com"
    And the assignee is "michal-matoga"
    And Trello labels are configured:
      | Name        | Id                       |
      | Code Review | 686cbf33add233ccba380f46 |

  Scenario: Prepare a local worktree for a new review request
    Given a Trello card with label "Code Review" contains a PR URL
    And a bare repo exists at "~/g/[GH_HOST]/[org]/[repo].git"
    When the review sessions workflow runs
    Then the PR branch is fetched into the bare repo
    And a worktree is created at "~/g/[GH_HOST]/[org]/[repo]/[pr-<number>]"

  Scenario: Create a base branch worktree for diffs
    Given a Trello card with label "Code Review" contains a PR URL
    And the PR base branch is "<base-branch>"
    When the review sessions workflow runs
    Then a worktree is created at "~/g/[GH_HOST]/[org]/[repo]/[<base-branch>]"

  Scenario: Spawn review sessions for a new request
    Given a Trello card with label "Code Review" contains a PR URL
    And the card has no session comment
    When the review sessions workflow runs
    Then an opencode session is started for "Review org/repo#<number>"
    And an AoE session is created in group "reviews/[GH_HOST]/org/repo"
    And the card receives a comment containing "opencode -s <sessionId>"

  Scenario: Skip sessions when a session comment exists
    Given a Trello card with label "Code Review" contains a PR URL
    And the card has a comment containing "opencode -s <sessionId>"
    When the review sessions workflow runs
    Then no new review sessions are started for the card
