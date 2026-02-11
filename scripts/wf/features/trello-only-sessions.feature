Feature: Trello-only tasks sessions
  The workflow creates work sessions from Trello cards without GitHub queries.

  Background:
    Given the Trello board "HZ7hcWZy" is reachable
    And Trello credentials are available via environment variables
    And the Trello list "Ready" has id "6689284f81d51c086a80879c"
    And the Trello list "Doing" has id "668928577acb6ab04b723321"
    And the Trello label "dwp" is present on cards

  Scenario: Spawn sessions for Ready cards with repo labels
    Given a Trello card in the "Ready" list has label "dwp"
    And the card has label "dotfiles"
    And the card has no session comment
    When the Trello-only sessions workflow runs
    Then a worktree is created under "~/g/github.com/michalmatoga/dotfiles/<slug>"
    And an opencode session is started for the slug
    And an AoE session is created in the default profile
    And the card receives a comment containing "opencode -s <sessionId>"

  Scenario: Skip Ready cards without a repo label mapping
    Given a Trello card in the "Ready" list has label "dwp"
    And the card has no label "dotfiles" or "Elikonas"
    When the Trello-only sessions workflow runs
    Then no new sessions are started for the card

  Scenario: Skip Ready cards with existing session comments
    Given a Trello card in the "Ready" list has label "dwp"
    And the card has label "Elikonas"
    And the card has a comment containing "opencode -s <sessionId>"
    When the Trello-only sessions workflow runs
    Then no new sessions are started for the card

  Scenario: Skip cards that are not in Ready or Doing
    Given a Trello card has label "dwp"
    And the card has label "dotfiles"
    And the card is not in the "Ready" or "Doing" list
    When the Trello-only sessions workflow runs
    Then no new sessions are started for the card
