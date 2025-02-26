#!/usr/bin/env bash

pulumi ${PULUMI_CWD:+--cwd=$PULUMI_CWD} "$@"
