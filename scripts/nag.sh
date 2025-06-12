#!/usr/bin/env bash

while true; do powershell.exe -c "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\tada.wav').PlaySync();"; sleep 0.5; done
