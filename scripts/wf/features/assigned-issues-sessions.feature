Feature: Assigned issues work sessions
  The workflow creates work sessions for assigned issue cards in Ready.

  Background:
    Given the Trello board "HZ7hcWZy" is reachable
    And Trello credentials are available via environment variables
    And the GitHub Enterprise host is "schibsted.ghe.com"
    And the assignee is "michal-matoga"
    And Trello labels are configured:
      | Name               | Id                       |
      | Praca w Schibsted  | 6694db7c23e5de7bec1b7489 |
    And the Trello list "Ready" has id "6689284f81d51c086a80879c"
    And the Trello list "Doing" has id "668928577acb6ab04b723321"

  Scenario: Spawn issue sessions for Ready cards without a session comment
    Given a Trello card in the "Ready" list has label "Praca w Schibsted"
    And the card contains an issue URL
    And the card has no session comment
    When the assigned issues sessions workflow runs
    Then a bare repo exists at "~/g/[GH_HOST]/[org]/[repo].git"
    And a worktree is created at "~/g/[GH_HOST]/[org]/[repo]/[issue-<number>]"
    And a worktree is created at "~/g/[GH_HOST]/[org]/[repo]/[base-branch]"
    And an opencode session is started for the issue
    And an AoE session is created in group "issues/[org]/[repo]"
    And the card receives a comment containing "opencode -s <sessionId>"

  Scenario: Skip Ready cards that already have a session comment
    Given a Trello card in the "Ready" list has label "Praca w Schibsted"
    And the card contains an issue URL
    And the card has a comment containing "opencode -s <sessionId>"
    When the assigned issues sessions workflow runs
    Then no new sessions are started for the card

  Scenario: Skip cards that are not in Ready or Doing
    Given a Trello card has label "Praca w Schibsted"
    And the card contains an issue URL
    And the card is not in the "Ready" or "Doing" list
    When the assigned issues sessions workflow runs
    Then no new sessions are started for the card

  Scenario: Skip Ready cards without an issue URL
    Given a Trello card in the "Ready" list has label "Praca w Schibsted"
    And the card does not contain an issue URL
    When the assigned issues sessions workflow runs
    Then no new sessions are started for the card
