# Stop processes using port 5174
$connections = Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue
if ($connections) {
    $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $processIds) {
        try {
            $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "Stopping process: PID=$procId, Name=$($process.ProcessName)"
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Host "Stopped process $procId"
            }
        } catch {
            Write-Host "Failed to stop process $procId : $_"
        }
    }
    Start-Sleep -Seconds 2
    $remaining = Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue
    if ($remaining) {
        Write-Host "Warning: Port 5174 is still in use"
        $remaining | Format-Table OwningProcess, State
    } else {
        Write-Host "Port 5174 is now free"
    }
} else {
    Write-Host "No process found using port 5174"
}

