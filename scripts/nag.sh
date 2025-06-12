#!/usr/bin/env bash

echo -e "\n\nDone! Get over here! (ctrl + c to interrupt nagging process)"
while true; do powershell.exe -c "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\tada.wav').PlaySync();"; sleep 0.5; done
