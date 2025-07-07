#!/usr/bin/env bash

TIME=$(echo -e "today\nthis-week\nthis-month" | fzf)
TAGS=$(echo -e "dwp\ndww" | fzf)
gtm report -format timeline-hours -author michmato -${TIME} -tags ${TAGS}
gtm report -format summary -author michmato -${TIME} -tags ${TAGS}
