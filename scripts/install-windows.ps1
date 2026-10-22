[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cepSource = Join-Path $projectRoot 'cep'
$extensionPath = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.mcp.premiere.bridge'
$serverPath = Join-Path $projectRoot 'dist\server.js'

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Executable $Arguments" }
}

try {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
    $nodeVersion = (& $nodePath --version | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw 'Unable to read the Node.js version.' }
    $nodeMajor = [int]$Matches[1]
    if ($nodeMajor -lt 22) { throw 'Install Node.js 22 or newer, including npm, then reopen the terminal.' }
    foreach ($relative in @('cep\CSXS\manifest.xml', 'package.json', 'package-lock.json', 'tsconfig.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw "Missing project file: $relative" }
    }

    # Never replace another installation or remove a real directory.
    $existing = Get-Item -LiteralPath $extensionPath -Force -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        if ($existing.LinkType -ne 'Junction') {
            throw "An existing non-junction extension occupies $extensionPath. Back it up and resolve the conflict manually."
        }
        $targets = @($existing.Target)
        if ($targets.Count -ne 1 -or [IO.Path]::GetFullPath($targets[0]).TrimEnd('\') -ine $cepSource.TrimEnd('\')) {
            throw "An extension already points to another checkout: $($targets -join ', '). Use that checkout or resolve the conflict manually."
        }
    }
    Write-Host "Project: $projectRoot"
    Write-Host "CEP junction: $extensionPath -> $cepSource"
    Write-Host "Node: $nodePath"
    if ($CheckOnly) {
        Write-Host 'Preflight passed. No dependencies, registry values, links or MCP settings were changed.'
        exit 0
    }

    Push-Location -LiteralPath $projectRoot
    try {
        Invoke-Checked -Executable $npmPath -Arguments @('ci', '--no-audit', '--no-fund')
        Invoke-Checked -Executable $npmPath -Arguments @('run', 'build')
        Invoke-Checked -Executable $npmPath -Arguments @('test')
    } finally { Pop-Location }
    if (!(Test-Path -LiteralPath $serverPath)) { throw 'Build did not produce dist/server.js.' }

    # PR 2023 uses CEP 11. This permits unsigned extensions for the current user.
    $registryPath = 'HKCU:\Software\Adobe\CSXS.11'
    New-Item -Path $registryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $registryPath -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
    if ($null -eq $existing) {
        New-Item -ItemType Directory -Path (Split-Path $extensionPath -Parent) -Force | Out-Null
        New-Item -ItemType Junction -Path $extensionPath -Target $cepSource | Out-Null
    }
    Write-Host ''
    Write-Host 'Installed. Keep this project folder in place. Restart Premiere; the hidden CEP bridge service owns port 8097.'
    Write-Host 'Open Window > Extensions > MCP Bridge for status and service startup. Update all MCP clients to protocol 2.'
    Write-Host 'Run the following in PowerShell to register this server with Codex CLI (existing name must be checked first):'
    $quotedNode = "'" + $nodePath.Replace("'", "''") + "'"
    $quotedServer = "'" + $serverPath.Replace("'", "''") + "'"
    Write-Host "codex mcp add premiere-pro -- $quotedNode $quotedServer"
    Write-Host 'For another MCP client, merge this entry into its configuration:'
    @{ mcpServers = @{ 'premiere-pro' = @{ command = $nodePath; args = @($serverPath) } } } | ConvertTo-Json -Depth 5
    Write-Host 'Restart the MCP clients. Multiple stdio MCP processes can connect to the same hidden CEP service.'
    Write-Host 'Check connected=true, mode=client, protocol=2 and jsxReady=true, then validate a short test project.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
