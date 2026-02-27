#!/usr/bin/env bash
set -euo pipefail

app_name="WSL"
title="WSL Notification"
body="Hello from WSL2"

if [ "$#" -ge 1 ]; then
  app_name="$1"
  shift
fi
if [ "$#" -ge 1 ]; then
  title="$1"
  shift
fi
if [ "$#" -ge 1 ]; then
  body="$*"
fi

payload=$(jq -n --arg app "$app_name" --arg title "$title" --arg body "$body" '{app:$app, title:$title, body:$body}')
printf '%s' "$payload" | powershell.exe -NoProfile -Command "& { \$raw = [Console]::In.ReadToEnd(); \$data = \$raw | ConvertFrom-Json; \$app = \$data.app; \$title = \$data.title; \$body = \$data.body; [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > \$null; \$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \$text = \$template.GetElementsByTagName('text'); \$text.Item(0).AppendChild(\$template.CreateTextNode(\$title)) > \$null; \$text.Item(1).AppendChild(\$template.CreateTextNode(\$body)) > \$null; \$toast = [Windows.UI.Notifications.ToastNotification]::new(\$template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(\$app).Show(\$toast) }"
