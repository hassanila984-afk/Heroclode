# Luma's hands on Windows. Firefly runs this in the background and talks to it one JSON line at a time:
# a command in ({"id":1,"cmd":"wheel",...}), an answer out ({"id":1,...}). It only does what Firefly asks:
# list and start programs, scroll, press keys, and find, click or type into a named button or field of a
# window (Windows UI Automation). Firefly asks the person before every click and every bit of typing.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class LumaWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  // Win, Ctrl, Alt and Shift let go if any is still down (a stuck Win + Ctrl + Enter starts Narrator)
  public static void LetGo() {
    foreach (byte k in new byte[] { 0x5B, 0x5C, 0x11, 0x12, 0x10 }) if ((GetAsyncKeyState(k) & 0x8000) != 0) keybd_event(k, 0, 2, UIntPtr.Zero);
  }
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  // a window covering its whole screen (a game, a full-screen video), not the desktop itself
  public static bool FullScreen(IntPtr h) {
    var c = new StringBuilder(64); GetClassName(h, c, 64);
    var cls = c.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return false;
    RECT r; if (!GetWindowRect(h, out r)) return false;
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
  }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@

$UIA = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$KINDS = @($CT::Button, $CT::Hyperlink, $CT::MenuItem, $CT::ListItem, $CT::TabItem, $CT::Edit, $CT::CheckBox, $CT::RadioButton, $CT::ComboBox, $CT::TreeItem, $CT::SplitButton)
$VK = @{ alt = 0x12; ctrl = 0x11; shift = 0x10; win = 0x5B; left = 0x25; right = 0x27; up = 0x26; down = 0x28; enter = 0x0D; tab = 0x09; esc = 0x1B; space = 0x20; pgdn = 0x22; pgup = 0x21; home = 0x24; end = 0x23
  backspace = 0x08; delete = 0x2E; insert = 0x2D; printscreen = 0x2C
  volume_up = 0xAF; volume_down = 0xAE; mute = 0xAD; play_pause = 0xB3; next_track = 0xB0; prev_track = 0xB1; stop_media = 0xB2 }
# letters, digits and F-keys too
foreach ($c in [char[]]'abcdefghijklmnopqrstuvwxyz') { $VK["$c"] = [int][char]::ToUpper($c) }
foreach ($d in 0..9) { $VK["$d"] = 0x30 + $d }
foreach ($f in 1..12) { $VK["f$f"] = 0x6F + $f }

function WindowInfo([IntPtr]$h) {
  $procId = [uint32]0
  [void][LumaWin]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''
  try { $name = (Get-Process -Id $procId).ProcessName } catch {}
  @{ hwnd = [int64]$h; app = $name; title = [LumaWin]::Title($h); fullscreen = [LumaWin]::FullScreen($h) }
}

# Bring their window to the front (Windows lets a background program do that right after an Alt press).
function Focus([IntPtr]$h) {
  if (-not [LumaWin]::IsWindow($h)) { throw 'gone' }
  if ([LumaWin]::IsIconic($h)) { [void][LumaWin]::ShowWindow($h, 9) }
  if ([LumaWin]::GetForegroundWindow() -ne $h) {
    [LumaWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [LumaWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][LumaWin]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 120
  }
}

function Wheel([IntPtr]$h, [string]$dir, [int]$notches) {
  if (-not [LumaWin]::IsWindow($h)) { throw 'gone' }
  $r = New-Object LumaWin+RECT; [void][LumaWin]::GetWindowRect($h, [ref]$r)
  $p = New-Object LumaWin+POINT; [void][LumaWin]::GetCursorPos([ref]$p)
  # the wheel goes to whatever is under the pointer: keep it inside their window
  if ($p.X -lt $r.L -or $p.X -gt $r.R -or $p.Y -lt $r.T -or $p.Y -gt $r.B) { [void][LumaWin]::SetCursorPos([int](($r.L + $r.R) / 2), [int](($r.T + $r.B) / 2)) }
  $delta = if ($dir -eq 'up') { 120 } else { -120 }
  for ($i = 0; $i -lt $notches; $i++) { [LumaWin]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero); Start-Sleep -Milliseconds 25 }
}

function Keys([IntPtr]$h, [string]$combo) {
  if ($h -ne [IntPtr]::Zero) { Focus $h }
  $parts = $combo.ToLower().Split('+') | ForEach-Object { $VK[$_] }
  if ($parts -contains $null) { throw 'unknown key' }
  foreach ($k in $parts) { [LumaWin]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero) }
  [array]::Reverse($parts)
  foreach ($k in $parts) { [LumaWin]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 30
  [LumaWin]::LetGo()
}

# The buttons and fields a person could see in their window, with the words on them.
function Elements([IntPtr]$h) {
  $root = $UIA::FromHandle($h)
  $conds = @(); foreach ($k in $KINDS) { $conds += New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, $k) }
  $any = New-Object System.Windows.Automation.OrCondition($conds)
  $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $any)
  $out = @()
  foreach ($e in $found) {
    if ($out.Count -ge 120) { break }
    try {
      $c = $e.Current
      if ($c.IsOffscreen) { continue }
      $label = ($c.Name -replace '\s+', ' ').Trim()
      $field = $c.ControlType -eq $CT::Edit
      if (-not $label -and $field) { $label = ($c.HelpText).Trim() }
      if (-not $label) { continue }
      if ($label.Length -gt 40) { $label = $label.Substring(0, 40) }
      $out += ,@{ el = $e; label = $label; field = $field; password = $c.IsPassword }
    } catch {}
  }
  return ,$out
}

function Best($items, [string]$want, [bool]$field) {
  $w = $want.ToLower().Trim(); $best = $null; $score = 0
  foreach ($it in $items) {
    if ($field -and -not $it.field) { continue }
    $l = $it.label.ToLower()
    $s = if ($l -eq $w) { 4 } elseif ($l.StartsWith($w)) { 3 } elseif ($w -and $l.Contains($w)) { 2 } elseif ($w -and $w.Contains($l)) { 1 } elseif ($field -and -not $w) { 1 } else { 0 }
    if ($s -gt $score) { $score = $s; $best = $it }
  }
  return $best
}

function Click($it, [IntPtr]$h) {
  $e = $it.el; $p = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return }
  if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return }
  # nothing to press through UI Automation: a real click in the middle of it
  Focus $h
  $b = $e.Current.BoundingRectangle
  [void][LumaWin]::SetCursorPos([int]($b.X + $b.Width / 2), [int]($b.Y + $b.Height / 2))
  [LumaWin]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero); [LumaWin]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
}

function TypeInto($it, [IntPtr]$h, [string]$text) {
  $e = $it.el; $p = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p) -and -not $p.Current.IsReadOnly) { $p.SetValue($text); return }
  Focus $h
  $e.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait(($text -replace '([+^%~(){}\[\]])', '{$1}'))
}

function Handle($c) {
  $h = if ($c.hwnd) { [IntPtr][int64]$c.hwnd } else { [IntPtr]::Zero }
  switch ($c.cmd) {
    'fg'     { return (WindowInfo ([LumaWin]::GetForegroundWindow())) }
    'apps'   { return @{ apps = @(Get-StartApps | ForEach-Object { @{ n = $_.Name; id = $_.AppID } }) } }
    'launch' { Start-Process 'explorer.exe' ('shell:AppsFolder\' + $c.app); return @{ ok = $true } }
    'wheel'  { Wheel $h $c.dir ([int]$c.notches); return @{ ok = $true } }
    'keys'   { Keys $h $c.keys; return @{ ok = $true } }
    # bring a program's window to the front by its name or window title
    'activate' {
      $w = $c.name.ToLower()
      $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName.ToLower().Contains($w) -or $_.MainWindowTitle.ToLower().Contains($w)) } | Select-Object -First 1
      if (-not $p) { return @{ ok = $false } }
      Focus ([IntPtr]$p.MainWindowHandle)
      return @{ ok = $true; app = $p.ProcessName }
    }
    'window' { if ($h -eq [IntPtr]::Zero) { $h = [LumaWin]::GetForegroundWindow() }; [void][LumaWin]::ShowWindow($h, $(if ($c.how -eq 'min') { 6 } elseif ($c.how -eq 'max') { 3 } else { 9 })); return @{ ok = $true } }
    # typing into whatever has the keyboard right now
    'typehere' { if ($h -ne [IntPtr]::Zero) { Focus $h }; [System.Windows.Forms.SendKeys]::SendWait(($c.text -replace '([+^%~(){}\[\]])', '{$1}')); return @{ ok = $true } }
    'screen' {
      $info = WindowInfo $h
      $items = Elements $h
      $info.private = [bool]($items | Where-Object { $_.password })
      $info.items = @($items | Select-Object -First 40 | ForEach-Object { $(if ($_.field) { 'field: ' } else { 'button: ' }) + $_.label })
      return $info
    }
    'find'   { $it = Best (Elements $h) $c.name ([bool]$c.field); if ($it) { return @{ found = $true; label = $it.label; password = [bool]$it.password } } else { return @{ found = $false } } }
    'click'  { $it = Best (Elements $h) $c.name $false; if (-not $it) { return @{ ok = $false } }; Click $it $h; return @{ ok = $true } }
    'type'   { $it = Best (Elements $h) $c.name $true; if (-not $it -or $it.password) { return @{ ok = $false } }; TypeInto $it $h $c.text; return @{ ok = $true } }
    default  { return @{ error = 'unknown' } }
  }
}

[LumaWin]::LetGo()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $c = $null
  try { $c = $line | ConvertFrom-Json; $r = Handle $c } catch { $r = @{ error = $_.Exception.Message } }
  if ($r -isnot [hashtable]) { $r = @{ value = $r } }
  if ($c -and $c.cmd -in @('keys', 'click', 'type')) { try { [LumaWin]::LetGo() } catch {} }
  if ($c) { $r.id = $c.id }
  [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
