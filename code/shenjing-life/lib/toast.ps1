# lib/toast.ps1 - Windows toast fallback (ASCII-only on purpose, see note below)
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File toast.ps1 -DataFile <utf8 json>
#   json: {"title":"...","text":"..."}
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as the system
#       code page (936 here) unless the file has a UTF-8 BOM, and non-ASCII comments
#       break the parser with "UnexpectedToken". All Chinese text arrives via $DataFile.
param(
  [Parameter(Mandatory = $true)][string]$DataFile
)

$ErrorActionPreference = 'Stop'

try {
  $json = Get-Content -LiteralPath $DataFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $Title = [string]$json.title
  if ([string]::IsNullOrWhiteSpace($Title)) { $Title = 'DSH' }
  $Text = [string]$json.text

  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

  $appId = 'DSH Desktop Beta'
  try {
    $startApp = Get-StartApps | Where-Object { $_.Name -like '*DSH*' } | Select-Object -First 1
    if ($startApp) { $appId = $startApp.AppID }
  } catch { }

  $escTitle = [System.Security.SecurityElement]::Escape($Title)
  $escText = [System.Security.SecurityElement]::Escape($Text)
  $xml = '<toast duration="long"><visual><binding template="ToastGeneric"><text>' + $escTitle + '</text><text>' + $escText + '</text></binding></visual><audio src="ms-winsoundevent:Notification.Default" /></toast>'

  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)

  Write-Output 'TOAST-OK'
  exit 0
} catch {
  Write-Output ('TOAST-FAIL ' + $_.Exception.Message)
  exit 1
}
