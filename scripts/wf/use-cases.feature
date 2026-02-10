Feature: Agent workflow automation
  The scheduler monitors Trello and GitHub Enterprise and executes automated workflows.
  It prefers safe, read-only checks before side-effecting actions.

  Background:
    Given the Trello board "HZ7hcWZy" is reachable
    And Trello credentials are available via environment variables
    And the GitHub Enterprise host is "schibsted.ghe.com"
    And the assignee is "michal-matoga"
    And Trello labels are configured:
      | Name               | Id                       |
      | Code Review        | 686cbf33add233ccba380f46 |
      | Praca w Schibsted  | 6694db7c23e5de7bec1b7489 |

  # Workflow 1: Code Review Requests to Trello
  Scenario: Create a Trello card for a new review request
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    And no open Trello card on board "HZ7hcWZy" references the PR URL
    When the review request workflow runs
    Then a Trello card is created in the "Blocked" list
    And the card title is formatted as "REVIEW: [org/repo] <original PR title>"
    And the card description includes the PR URL and PR description
    And the card has labels "Code Review" and "Praca w Schibsted"

  Scenario: Skip creation when a review request is already tracked
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    And an open Trello card already references the PR URL
    When the review request workflow runs
    Then no new Trello card is created

  Scenario: Archive obsolete review request cards
    Given an open Trello card has label "Code Review"
    And the referenced PR is merged without my review
    When the review request workflow runs
    Then the Trello card is archived

  Scenario: Complete review request cards when approved
    Given an open Trello card has label "Code Review"
    And the referenced PR is approved by me
    When the review request workflow runs
    Then the Trello card is moved to the "Done" list

  Scenario: Ignore draft pull requests
    Given a draft PR has a review request assigned to me on "schibsted.ghe.com"
    When the review request workflow runs
    Then the draft PR is excluded from card creation

  # Workflow 2: Review Request Workspace + Sessions
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

  Scenario: Run Trello sync only
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    When the review request workflow runs with "--trello"
    Then Trello cards are created or archived as needed
    And no review sessions are started

  Scenario: Run sessions only
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    When the review request workflow runs with "--sessions"
    Then review sessions are started as needed
    And no Trello cards are created or archived

  Scenario: Dry-run does not mutate Trello
    Given a pending review request assigned to me exists on "schibsted.ghe.com"
    And no open Trello card on board "HZ7hcWZy" references the PR URL
    When the review request workflow runs with "--dry-run"
    Then no Trello cards are created or archived
