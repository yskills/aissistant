param(
  [switch]$Apply,
  [switch]$ApplyStartupTrim,
  [ValidateSet('balanced','high','power-saver')]
  [string]$PowerPlan = 'balanced',
  [int]$CpuPercentOnBattery = 85,
  [int]$CpuPercentPluggedIn = 100,
  [int]$TempDays = 14
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
  Write-Host "[optimize] $msg"
}

function Invoke-Safe($scriptBlock, $description) {
  try {
    & $scriptBlock
    Write-Host "[ok] $description"
  } catch {
    Write-Warning "[skip] $description :: $($_.Exception.Message)"
  }
}

Write-Step "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })"
Write-Step "PowerPlan=$PowerPlan, CpuBattery=$CpuPercentOnBattery, CpuAC=$CpuPercentPluggedIn, TempDays=$TempDays, StartupTrim=$ApplyStartupTrim"

$plans = @{
  'balanced' = '381b4222-f694-41f0-9685-ff5bb260df2e'
  'high' = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
  'power-saver' = 'a1841308-3541-4fab-bc81-f71556f20b4a'
}

if ($Apply) {
  $planGuid = $plans[$PowerPlan]
  Invoke-Safe { powercfg /SETACTIVE $planGuid | Out-Null } "Power plan set to $PowerPlan"

  # Processor power management (subgroup + maximum processor state)
  $subProcessor = '54533251-82be-4824-96c1-47b60b740d00'
  $settingMaxProc = 'bc5038f7-23e0-4960-96da-33abaf5935ec'
  Invoke-Safe { powercfg /SETDCVALUEINDEX SCHEME_CURRENT $subProcessor $settingMaxProc $CpuPercentOnBattery | Out-Null } "CPU max on battery set to $CpuPercentOnBattery%"
  Invoke-Safe { powercfg /SETACVALUEINDEX SCHEME_CURRENT $subProcessor $settingMaxProc $CpuPercentPluggedIn | Out-Null } "CPU max on AC set to $CpuPercentPluggedIn%"
  Invoke-Safe { powercfg /S SCHEME_CURRENT | Out-Null } "Current power scheme reloaded"

  if ($ApplyStartupTrim) {
    # Disable startup apps for current user (safe, reversible)
    $startupReg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    Invoke-Safe {
      if (-not (Test-Path $startupReg)) { return }
      $keep = @('SecurityHealth','Windows Defender','OneDrive')
      $props = (Get-ItemProperty -Path $startupReg).PSObject.Properties |
        Where-Object { $_.Name -notin @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') }

      foreach ($prop in $props) {
        if ($keep -contains $prop.Name) { continue }
        # Disabled format in StartupApproved: first byte 0x03
        Set-ItemProperty -Path $startupReg -Name $prop.Name -Value ([byte[]](3,0,0,0,0,0,0,0,0,0,0,0))
      }
    } "Startup apps (HKCU StartupApproved Run) trimmed"
  } else {
    Write-Host "[info] Startup trim skipped (use -ApplyStartupTrim to enable)."
  }

  # Temp cleanup (user scope)
  Invoke-Safe {
    $cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($TempDays))
    $temp = [System.IO.Path]::GetTempPath()
    Get-ChildItem -Path $temp -Force -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  } "User temp cleanup complete"
}

# Always print quick diagnostics
Write-Host ""
Write-Host "=== QUICK DIAGNOSTICS ==="
Invoke-Safe { powercfg /GETACTIVESCHEME } "Active power scheme"
Invoke-Safe {
  Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, CPU, PM | Format-Table -AutoSize
} "Top CPU processes"
Invoke-Safe {
  Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location | Format-Table -AutoSize
} "Startup commands"

Write-Host ""
if ($Apply) {
  Write-Host "Fertig. Bei Bedarf Neustart durchführen."
} else {
  Write-Host "Dry-run beendet. Mit -Apply werden die Optimierungen gesetzt."
}
