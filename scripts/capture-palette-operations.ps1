param(
    # Example:
    # powershell -NoProfile -ExecutionPolicy Bypass -File .\capture-palette-operations.ps1 -Only status,map
    [string]$PalettePath = "C:\axon-test\portable-56a2b8c4\axon-palette.exe",
    [string]$OutputDir = "C:\axon-test\palette-operation-screens",
    [string[]]$Only = @(),
    [switch]$FullScreen
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("PaletteCaptureWin32" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;

public class PaletteCaptureWin32 {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out PaletteCaptureRect rect);
}

public struct PaletteCaptureRect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
"@
}

$operations = @(
    @{ Name = "01-status";    Command = "status";                                           WaitSeconds = 4  },
    @{ Name = "02-doctor";    Command = "doctor";                                           WaitSeconds = 20 },
    @{ Name = "03-map";       Command = "map https://example.com";                          WaitSeconds = 9  },
    @{ Name = "04-scrape";    Command = "scrape https://example.com --embed false";         WaitSeconds = 9  },
    @{ Name = "05-crawl";     Command = "crawl https://example.com --embed false --max-pages 1"; WaitSeconds = 6 },
    @{ Name = "06-search";    Command = "search axon rust";                                 WaitSeconds = 11 },
    @{ Name = "07-research";  Command = "research axon rust";                               WaitSeconds = 25 },
    @{ Name = "08-ask";       Command = "ask what is axon";                                 WaitSeconds = 35 },
    @{ Name = "09-ingest";    Command = "ingest https://github.com/jmagar/axon --no-source"; WaitSeconds = 10 },
    @{ Name = "10-ask-reset"; Command = "ask-reset";                                        WaitSeconds = 3  }
)

if ($Only.Count -gt 0) {
    $wanted = @{}
    foreach ($name in ($Only | ForEach-Object { $_ -split "," })) {
        $trimmed = $name.Trim()
        if ($trimmed.Length -gt 0) {
            $wanted[$trimmed] = $true
        }
    }
    $operations = @($operations | Where-Object {
        $wanted.ContainsKey($_.Name) -or $wanted.ContainsKey(($_.Name -replace '^\d+-', ''))
    })
    if ($operations.Count -eq 0) {
        throw "No operations matched -Only: $($Only -join ', ')"
    }
}

function Stop-Palette {
    Stop-Process -Name axon-palette -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

function Start-Palette {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Palette executable not found: $Path"
    }

    $workDir = Split-Path -Parent $Path
    $ws = New-Object -ComObject WScript.Shell
    [Environment]::SetEnvironmentVariable("SEE_MASK_NOZONECHECKS", "1", "Process")
    # WScript launched from PowerShell keeps keyboard focus reliable for GPUI.
    $null = $ws.Run("`"$Path`"", 1, $false)
    Start-Sleep -Seconds 2

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if ($ws.AppActivate("Axon Palette")) {
            Start-Sleep -Milliseconds 300
            return $ws
        }
        Start-Sleep -Milliseconds 250
    }

    throw "Axon Palette did not become foreground after launch from $workDir"
}

function Get-PaletteProcess {
    $process = Get-Process axon-palette -ErrorAction Stop | Select-Object -First 1
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
        throw "Axon Palette process has no main window handle yet."
    }
    return $process
}

function Save-Screenshot {
    param(
        [string]$Name,
        [switch]$Screen
    )

    $path = Join-Path $OutputDir "$Name.png"

    if ($Screen) {
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    } else {
        $process = Get-PaletteProcess
        $rect = New-Object PaletteCaptureRect
        [PaletteCaptureWin32]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null
        $width = [Math]::Max(1, $rect.Right - $rect.Left)
        $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
        $bitmap = New-Object System.Drawing.Bitmap $width, $height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
    }

    try {
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }

    return $path
}

New-Item -ItemType Directory -Force $OutputDir | Out-Null

$captures = @()
foreach ($operation in $operations) {
    Stop-Palette
    $shell = Start-Palette -Path $PalettePath
    $shell.SendKeys($operation.Command + "{ENTER}")
    Start-Sleep -Seconds ([int]$operation.WaitSeconds)

    $captures += [pscustomobject]@{
        Operation = $operation.Name
        Command = $operation.Command
        Path = Save-Screenshot -Name $operation.Name -Screen:$FullScreen
    }
}

Stop-Palette

$manifestPath = Join-Path $OutputDir "manifest.json"
$captures | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$captures | Format-Table -AutoSize
Write-Host "Manifest: $manifestPath"
