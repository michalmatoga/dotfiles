Feature: Assigned issues to Trello
  The workflow syncs open GitHub issues assigned to me into Trello.

  Background:
    Given the Trello board "HZ7hcWZy" is reachable
    And Trello credentials are available via environment variables
    And the GitHub Enterprise host is "schibsted.ghe.com"
    And the assignee is "michal-matoga"
    And Trello labels are configured:
      | Name               | Id                       |
      | Praca w Schibsted  | 6694db7c23e5de7bec1b7489 |

  Scenario: Create a Trello card for a newly assigned issue
    Given an open issue assigned to me exists on "schibsted.ghe.com"
    And no open Trello card on board "HZ7hcWZy" references the issue URL
    When the assigned issues workflow runs
    Then a Trello card is created in the "New" list
    And the card has label "Praca w Schibsted"

  Scenario: Skip creation when an assigned issue is already tracked
    Given an open issue assigned to me exists on "schibsted.ghe.com"
    And an open Trello card already references the issue URL
    When the assigned issues workflow runs
    Then no new Trello card is created

  Scenario: Archive obsolete assigned issue cards
    Given an open Trello card has label "Praca w Schibsted"
    And the referenced issue is closed or no longer assigned to me
    When the assigned issues workflow runs
    Then the Trello card is archived
