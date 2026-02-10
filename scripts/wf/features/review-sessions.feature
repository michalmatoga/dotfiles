Feature: Review request workspace and sessions
  The workflow prepares local worktrees and spawns review sessions.

  Background:
    Given the GitHub Enterprise host is "schibsted.ghe.com"
    And the assignee is "michal-matoga"

  Scenario: Prepare a local worktree for a new review request
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    And a bare repo exists at "~/g/[GH_HOST]/[org]/[repo].git"
    When the review request workflow runs with "--sessions"
    Then the PR branch is fetched into the bare repo
    And a worktree is created at "~/g/[GH_HOST]/[org]/[repo]/[pr-<number>]"

  Scenario: Spawn review sessions for a new request
    Given a new review request is detected
    When the review request workflow runs with "--sessions"
    Then an opencode session is started for "Review org/repo#<number>"
    And an AoE session is created in group "reviews/[GH_HOST]/org/repo"

  Scenario: Run sessions only
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    When the review request workflow runs with "--sessions"
    Then review sessions are started as needed
    And no Trello cards are created or archived
