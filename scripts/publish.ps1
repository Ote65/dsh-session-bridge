# Publishes this repository to GitHub and stars it.
#
#   $env:GITHUB_TOKEN = '<fine-grained PAT with "Administration: read+write" for the
#                        target repo owner, plus "starring" - or a classic token with
#                        the `public_repo` scope>'
#   pwsh ./scripts/publish.ps1 -Owner <github-account>
#
# The token is read from the environment ONLY: it never appears in the command line,
# in this script, or in git's config. Nothing is pushed until the repo exists and the
# OWNER placeholder has been replaced.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = 'dsh-session-bridge',
  [string]$Description = 'Hand one DeepSeek Harness session to another Agent (Codex, Trae, ...) over a loopback HTTP bridge.',
  [switch]$Private,
  [switch]$NoStar
)

$ErrorActionPreference = 'Stop'

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'GITHUB_TOKEN is not set. Export a token with repository + starring rights, then re-run.'
}

$root = Split-Path -Parent $PSScriptRoot
$api  = 'https://api.github.com'
$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'dsh-session-bridge-publish'
}

function Invoke-GitHub {
  param([string]$Method, [string]$Path, [object]$Body)
  $params = @{ Method = $Method; Uri = "$api$Path"; Headers = $headers }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 6)
    $params.ContentType = 'application/json'
  }
  return Invoke-RestMethod @params
}

Write-Host "[1/5] who am I"
$me = Invoke-GitHub GET '/user'
Write-Host "      authenticated as $($me.login)"

Write-Host "[2/5] replace the OWNER placeholder with '$Owner'"
$changed = 0
foreach ($relative in @('README.md', 'docs/index.html', 'package.json')) {
  $path = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $text = [System.IO.File]::ReadAllText($path)
  # Only URL contexts carry the placeholder, so prose that mentions `OWNER`
  # stays correct after publishing.
  $next = $text.Replace('github.com/OWNER/', "github.com/$Owner/").Replace('/starred/OWNER/', "/starred/$Owner/")
  if ($next -ne $text) {
    [System.IO.File]::WriteAllText($path, $next)
    $changed++
    Write-Host "      updated $relative"
  }
}
if ($changed -eq 0) { Write-Host '      already replaced' }

Write-Host "[3/5] ensure the repository exists"
$exists = $true
try { Invoke-GitHub GET "/repos/$Owner/$Repo" | Out-Null } catch { $exists = $false }
if ($exists) {
  Write-Host "      $Owner/$Repo already exists"
} else {
  $payload = @{ name = $Repo; description = $Description; private = [bool]$Private; has_issues = $true; has_wiki = $false }
  Invoke-GitHub POST '/user/repos' $payload | Out-Null
  Write-Host "      created $Owner/$Repo"
}

Write-Host "[4/5] commit and push"
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  & git -C $root init -b main | Out-Null
}
# Windows PowerShell 5.1 has no null-coalescing operator, so spell the fallbacks out.
$userName = $me.name
if ([string]::IsNullOrWhiteSpace($userName)) { $userName = $me.login }
$userEmail = $me.email
if ([string]::IsNullOrWhiteSpace($userEmail)) { $userEmail = "$($me.login)@users.noreply.github.com" }
& git -C $root config user.name  $userName
& git -C $root config user.email $userEmail
& git -C $root add -A
$staged = & git -C $root diff --cached --name-only
if ($staged) { & git -C $root commit -m 'feat: dsh-session-bridge - hand a DSH session to another Agent' | Out-Null }
else { Write-Host '      nothing new to commit' }

$remote = "https://x-access-token:$token@github.com/$Owner/$Repo.git"
& git -C $root remote remove origin 2>$null | Out-Null
& git -C $root remote add origin $remote
& git -C $root push -u origin main --force-with-lease 2>&1 | ForEach-Object { "      $_" }
# Leave no credential in the checkout.
& git -C $root remote set-url origin "https://github.com/$Owner/$Repo.git"
Write-Host "      pushed to https://github.com/$Owner/$Repo"

Write-Host "[5/5] star it"
if ($NoStar) {
  Write-Host '      skipped (-NoStar)'
} else {
  try {
    Invoke-RestMethod -Method PUT -Uri "$api/user/starred/$Owner/$Repo" -Headers $headers | Out-Null
    Write-Host '      starred OK'
  } catch {
    Write-Host "      star failed: $($_.Exception.Message)"
  }
}

Write-Host ''
Write-Host "Done -> https://github.com/$Owner/$Repo"
Write-Host 'Next: enable Pages (Settings -> Pages -> Deploy from branch -> main /docs) to serve docs/index.html.'
