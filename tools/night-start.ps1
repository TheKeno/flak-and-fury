# Starts a night-run script (default tools\night-3c.cmd) through WMI, so Windows launches it, not this
# shell: its parent is the WMI service, outside the Claude app's process tree, and it keeps running when
# the app or the session closes (part 3a's and 3b's runs, started from Claude's shell even "detached",
# were killed with the app). Prints the new process id and its parent's name to check.
#   powershell -ExecutionPolicy Bypass -File tools\night-start.ps1 [tools\night-3c.cmd]
param([string]$Script = 'tools\night-3c.cmd')
$repo = Split-Path -Parent $PSScriptRoot
$full = Join-Path $repo $Script
if (-not (Test-Path $full)) { throw "No such script: $full" }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  # /s and the doubled quotes: the folder name has an '&', which a plain /c "..." hands to cmd unquoted.
  CommandLine = "cmd.exe /s /c `"`"$full`"`""
  CurrentDirectory = $repo
}
if ($r.ReturnValue -ne 0) { throw "Win32_Process Create failed: $($r.ReturnValue)" }
Start-Sleep -Seconds 2
$p = Get-CimInstance Win32_Process -Filter "ProcessId = $($r.ProcessId)"
if (-not $p) { throw "Process $($r.ProcessId) already gone: see notes
ight-status.txt" }
$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)"
"Started $Script as process $($r.ProcessId), parent $($parent.Name) ($($p.ParentProcessId))"
