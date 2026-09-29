# Report who owns port 8000 and list all python/uvicorn backends with cmdlines.
$ErrorActionPreference = 'SilentlyContinue'
Write-Host '=== Port 8000 listener ==='
$l = Get-NetTCPConnection -LocalPort 8000 -State Listen
if ($l) {
    foreach ($c in $l) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
        $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
        Write-Host "pid=$($p.ProcessId) ppid=$($p.ParentProcessId)"
        Write-Host "  cmd: $($p.CommandLine)"
        Write-Host "  parent[$($par.ProcessId)]: $($par.CommandLine)"
    }
} else { Write-Host 'PORT 8000 FREE' }

Write-Host '=== All python.exe backends ==='
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object {
    Write-Host "pid=$($_.ProcessId) ppid=$($_.ParentProcessId) :: $($_.CommandLine)"
}
