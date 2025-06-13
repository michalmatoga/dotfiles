#!/usr/bin/env bash

while true; do
    # Play sound
    powershell.exe -c "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Ring02.wav').PlaySync();"

    # Visual bell: change background color
    echo -e "\n\nDone! Get over here! (ctrl + c to interrupt nagging process)"
    echo -e "\033[41m"  # Set background to red
    sleep 0.1
    echo -e "\033[0m"   # Reset to default
    sleep 0.4
done
