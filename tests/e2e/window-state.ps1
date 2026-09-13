param([int]$TargetProcessId = 0, [int]$ParentProcessId = 0)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WorkstationWindowProbe {
    public delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int length);
}
'@

$candidateIds = @($TargetProcessId)
if ($ParentProcessId -gt 0) {
    $candidateIds = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentProcessId" |
        Where-Object { $_.Name -eq 'electron.exe' } | ForEach-Object { [int]$_.ProcessId })
}
$foundWindows = [System.Collections.Generic.List[object]]::new()
$callback = [WorkstationWindowProbe+EnumWindowProc] {
    param([IntPtr]$window, [IntPtr]$parameter)
    [uint32]$windowProcessId = 0
    [void][WorkstationWindowProbe]::GetWindowThreadProcessId($window, [ref]$windowProcessId)
    if ($candidateIds -contains [int]$windowProcessId) {
        $className = [System.Text.StringBuilder]::new(256)
        [void][WorkstationWindowProbe]::GetClassName($window, $className, $className.Capacity)
        if ($className.ToString() -eq 'Chrome_WidgetWin_1') {
            $title = [System.Text.StringBuilder]::new(512)
            [void][WorkstationWindowProbe]::GetWindowText($window, $title, $title.Capacity)
            $bounds = [WorkstationWindowProbe+Rect]::new()
            [void][WorkstationWindowProbe]::GetWindowRect($window, [ref]$bounds)
            $foundWindows.Add([pscustomobject]@{
                processId = $windowProcessId
                handle = $window.ToInt64()
                title = $title.ToString()
                visible = [WorkstationWindowProbe]::IsWindowVisible($window)
                minimized = [WorkstationWindowProbe]::IsIconic($window)
                x = $bounds.Left; y = $bounds.Top
                width = $bounds.Right - $bounds.Left; height = $bounds.Bottom - $bounds.Top
            })
        }
    }
    return $true
}
[void][WorkstationWindowProbe]::EnumWindows($callback, [IntPtr]::Zero)
ConvertTo-Json -InputObject @($foundWindows.ToArray()) -Compress
