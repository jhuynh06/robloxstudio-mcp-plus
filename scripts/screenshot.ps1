# screenshot.ps1 — Capture the Roblox Studio window as a PNG
# Usage: powershell.exe -ExecutionPolicy Bypass -File screenshot.ps1 [-OutputPath <path>]
param(
    [string]$OutputPath = ""
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Window {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

# Find Roblox Studio process
$studioProcess = Get-Process -Name "RobloxStudioBeta" -ErrorAction SilentlyContinue
if (-not $studioProcess) {
    $studioProcess = Get-Process -Name "RobloxStudio" -ErrorAction SilentlyContinue
}

if (-not $studioProcess) {
    Write-Error "Roblox Studio is not running"
    exit 1
}

# Get the main window handle
$hwnd = $studioProcess[0].MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Error "Could not find Roblox Studio window handle"
    exit 1
}

# Try DWM extended frame bounds first (more accurate with DWP/Aero)
$rect = New-Object Win32Window+RECT
$DWMWA_EXTENDED_FRAME_BOUNDS = 9
$hr = [Win32Window]::DwmGetWindowAttribute($hwnd, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))

if ($hr -ne 0) {
    # Fallback to GetWindowRect
    [Win32Window]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
    Write-Error "Invalid window dimensions: ${width}x${height}"
    exit 1
}

# Generate output path if not provided
if ([string]::IsNullOrEmpty($OutputPath)) {
    $OutputPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "roblox_studio_screenshot_$(Get-Date -Format 'yyyyMMdd_HHmmss').png")
}

# Capture the screen region
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
$graphics.Dispose()

# Save as PNG
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

# Output the path for the caller to read
Write-Output $OutputPath
