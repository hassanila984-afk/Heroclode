# Installs (or updates) Firefly for Windows for this user. Run in PowerShell:
#   irm https://firefly-3t9.pages.dev/pc | iex
# It downloads the app in pieces, puts it in your user folder (no admin needed), adds Start menu and
# desktop shortcuts, and opens it. To remove it later: Settings isn't needed, just delete the folder
#   %LOCALAPPDATA%\Programs\Firefly  and the two shortcuts.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = 'https://firefly-3t9.pages.dev/pcapp'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\Firefly'
$zip = Join-Path $env:TEMP 'firefly-windows.zip'

Write-Host ''
Write-Host '  Firefly for Windows' -ForegroundColor Yellow
Write-Host '  Getting Luma ready for your computer...' -ForegroundColor Gray
$info = Invoke-RestMethod "$base/parts.json"
$out = [IO.File]::Create($zip)
try {
  $i = 0
  foreach ($p in $info.parts) {
    $i++
    Write-Host ("  downloading {0}/{1}" -f $i, $info.parts.Count)
    $piece = Join-Path $env:TEMP "firefly-$p"
    Invoke-WebRequest "$base/$p" -UseBasicParsing -OutFile $piece
    $bytes = [IO.File]::ReadAllBytes($piece)
    $out.Write($bytes, 0, $bytes.Length)
    Remove-Item $piece -Force
  }
} finally { $out.Close() }
if ((Get-Item $zip).Length -ne $info.size) { throw 'The download was incomplete. Please run the command again.' }

Get-Process Firefly -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir*" } | Stop-Process -Force
Start-Sleep -Milliseconds 800
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Write-Host '  installing...'
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip -Force

$ws = New-Object -ComObject WScript.Shell
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Firefly.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Firefly.lnk')
)
foreach ($l in $links) {
  $s = $ws.CreateShortcut($l)
  $s.TargetPath = Join-Path $dir 'Firefly.exe'
  $s.WorkingDirectory = $dir
  $s.IconLocation = (Join-Path $dir 'resources\app\assets\firefly.ico') + ',0'
  $s.Description = 'Firefly - Luma'
  $s.Save()
}
Start-Process (Join-Path $dir 'Firefly.exe')
Write-Host ''
Write-Host '  Done! Luma is opening. Ctrl+Shift+L to talk to her any time.' -ForegroundColor Green
Write-Host ''
