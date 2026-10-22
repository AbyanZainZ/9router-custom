# update-9router.ps1 - Update 9router-master to latest global main, preserving local customs.
# Run: powershell -File C:\Users\abyan\Documents\9router-master\update-9router.ps1
#
# Strategy (v0.5.91+, 2026-09-30):
# - NEVER delete local-only files (automation pages, custom registries, bulk engine, icons).
# - SKIP (keep local): custom-server.js, 9 custom registries, 2 custom executors,
#   agnesAi video handler, usage/codebuddy, 11x providers/[id] UI files (AutoClaw check-in),
#   global agnes.js + agnes.png (collides with our richer agnes-ai / agnes-ai-cn).
# - MERGE (take global, re-apply customs): Sidebar (Automation entry), registry/index
#   (c0-c7 + drop p129/agnes.js), capabilities (8 provider blocks + agnes patterns),
#   next.config (camoufox/impit/playwright externals), components/index (BulkAccount
#   export), package.json (keep playwright + camoufox-js deps), testUtils (custom
#   provider validateUrl probe).
# - TAKE GLOBAL for everything else (combos table view, ModelSelectModal filter,
#   model.js, OAuthModal incl. Zed fix, providers API O(1), translators, executors...).
# - DB (connections, nodes, password) is untouched. Build + restart manually after.

$ErrorActionPreference = "Stop"
$local   = "C:\Users\abyan\Documents\9router-master"
$global_ = "C:\Users\abyan\AppData\Local\Temp\opencode\9router-git"

# NOTE: use -LiteralPath everywhere (paths contain [id], [kind], [toolId], [...path]).

$skipNew = @(
  "open-sse\providers\registry\agnes.js",   # collides with local agnes-ai / agnes-ai-cn
  "public\providers\agnes.png"
)

$skipChanged = @(
  "custom-server.js",                        # local h2c hardening (chunked reject + bodyTimer)
  "open-sse\providers\registry\index.js",    # MERGE below
  "open-sse\providers\capabilities.js",      # MERGE below
  "next.config.mjs",                         # MERGE below
  "src\shared\components\Sidebar.js",        # MERGE below (Automation entry)
  "src\shared\components\index.js",          # MERGE below (BulkAccount export)
  "package.json",                            # MERGE below (playwright + camoufox-js)
  "src\app\api\providers\[id]\test\testUtils.js", # MERGE below (custom probe)
  # providers/[id] UI keeps AutoClaw check-in + expiring badge (global refactored these):
  "src\app\(dashboard)\dashboard\providers\[id]\AddApiKeyModal.js",
  "src\app\(dashboard)\dashboard\providers\[id]\AddCustomModelModal.js",
  "src\app\(dashboard)\dashboard\providers\[id]\BulkImportCodexModal.js",
  "src\app\(dashboard)\dashboard\providers\[id]\BulkImportGrokCliModal.js",
  "src\app\(dashboard)\dashboard\providers\[id]\CompatibleModelsSection.js",
  "src\app\(dashboard)\dashboard\providers\[id]\ConnectionRow.js",
  "src\app\(dashboard)\dashboard\providers\[id]\CooldownTimer.js",
  "src\app\(dashboard)\dashboard\providers\[id]\EditCompatibleNodeModal.js",
  "src\app\(dashboard)\dashboard\providers\[id]\ModelRow.js",
  "src\app\(dashboard)\dashboard\providers\[id]\page.js",
  "src\app\(dashboard)\dashboard\providers\[id]\PassthroughModelsSection.js"
)

function Copy-GlobalFile($rel) {
  $gf = Join-Path $global_ $rel; $lf = Join-Path $local $rel
  $d = Split-Path -Parent $lf
  if (!(Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  Copy-Item -LiteralPath $gf -Destination $lf -Force
}

function Ensure-Contains($file, $marker, $insertAfter, $block) {
  $c = Get-Content -LiteralPath $file -Raw
  if ($c.Contains($marker)) { return $false }
  $idx = $c.IndexOf($insertAfter)
  if ($idx -lt 0) { Write-Host "  WARN: anchor not found in $file" -ForegroundColor Yellow; return $false }
  $pos = $idx + $insertAfter.Length
  $c = $c.Substring(0, $pos) + $block + $c.Substring($pos)
  Set-Content -LiteralPath $file -Value $c -Encoding UTF8
  return $true
}

Write-Host "=== [1/6] Clone latest ===" -ForegroundColor Cyan
if (Test-Path $global_) { Remove-Item $global_ -Recurse -Force }
$prevErr = $ErrorActionPreference; $ErrorActionPreference = "Continue"
git clone --depth 1 https://github.com/decolua/9router.git $global_ 2>&1 | Out-Null
$ErrorActionPreference = $prevErr
if (!(Test-Path -LiteralPath "$global_\package.json")) { Write-Host "  Clone failed!" -ForegroundColor Red; exit 1 }
$gver = (Get-Content "$global_\package.json" | ConvertFrom-Json).version
$lover = (Get-Content "$local\package.json" | ConvertFrom-Json).version
Write-Host "  $lover -> $gver"
if ($gver -le $lover) { Write-Host "  Already up to date." -ForegroundColor Yellow; exit 0 }

Write-Host "=== [2/6] Copy files (skip customs) ===" -ForegroundColor Cyan
$copied = 0; $skipped = 0
$allG = Get-ChildItem -LiteralPath $global_ -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\\.next\\|package-lock\.json$' }
foreach ($gf in $allG) {
  $rel = $gf.FullName.Substring($global_.Length + 1)
  $lf = Join-Path $local $rel
  if (!(Test-Path -LiteralPath $lf)) {
    if ($skipNew -contains $rel) { $skipped++; continue }
    Copy-GlobalFile $rel; $copied++
  } elseif ((Get-FileHash -LiteralPath $lf -Algorithm MD5).Hash -ne (Get-FileHash -LiteralPath $gf.FullName -Algorithm MD5).Hash) {
    if ($skipChanged -contains $rel) { $skipped++; continue }
    Copy-Item -LiteralPath $gf.FullName -Destination $lf -Force; $copied++
  }
}
Write-Host "  Updated+New: $copied  Skipped(custom): $skipped"

Write-Host "=== [3/6] Merge: Sidebar + registry/index + components/index ===" -ForegroundColor Cyan
Copy-GlobalFile 'src\shared\components\Sidebar.js'
$sb = Join-Path $local 'src\shared\components\Sidebar.js'
Ensure-Contains $sb '/dashboard/automation' '  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },' "`r`n  // Local custom: bulk OAuth automation (AutoClaw / CodeBuddy / Qoder / Agnes).`r`n  // Kept as a merge marker so upstream updates don't drop it again.`r`n  { href: "/dashboard/automation", label: "Automation", icon: "smart_toy" }," | Out-Null
Write-Host "  Sidebar: Automation entry ensured"

Copy-GlobalFile 'open-sse\providers\registry\index.js'
$ri = Join-Path $local 'open-sse\providers\registry\index.js'
$c = Get-Content -LiteralPath $ri -Raw
$c = $c.Replace('import p129 from "./agnes.js";', '// Local custom: global "./agnes.js" (id "agnes", alias "agnes-ai") is intentionally' + "`r`n" + '// NOT imported — it collides with our richer "agnes-ai" + "agnes-ai-cn" registries.')
$c = $c.Replace("  p129,`r`n", '')
$c = $c.Replace("  p129,`r`n", '')
if (!$c.Contains('import c0 from "./agnes-ai.js";')) {
  $c = $c.Replace('export default [', '// Local custom providers (Agnes global/CN, AutoClaw, GNRT, InferHub, Routeway, Infron, Empero).' + "`r`n" + 'import c0 from "./agnes-ai.js";' + "`r`n" + 'import c1 from "./agnes-ai-cn.js";' + "`r`n" + 'import c2 from "./autoclaw.js";' + "`r`n" + 'import c3 from "./gnrt.js";' + "`r`n" + 'import c4 from "./inferhub.js";' + "`r`n" + 'import c5 from "./routeway.js";' + "`r`n" + 'import c6 from "./infron.js";' + "`r`n" + 'import c7 from "./empero-free.js";' + "`r`n" + 'export default [')
  $c = $c.Replace("];", "  // Local custom providers (see c-imports above).`r`n  c0,`r`n  c1,`r`n  c2,`r`n  c3,`r`n  c4,`r`n  c5,`r`n  c6,`r`n  c7,`r`n];")
}
Set-Content -LiteralPath $ri -Value $c -Encoding UTF8
Write-Host "  registry/index: 4 new providers kept, agnes.js excluded, c0-c7 restored"

Copy-GlobalFile 'src\shared\components\index.js'
$ci = Join-Path $local 'src\shared\components\index.js'
Ensure-Contains $ci 'BulkAccountAutomationModal' 'export { default as CapacityBadges } from "./CapacityBadges";' "`r`n// Local custom: bulk OAuth automation modal (AutoClaw / CodeBuddy / Qoder).`r`nexport { default as BulkAccountAutomationModal } from ""./BulkAccountAutomationModal"";" | Out-Null
Write-Host "  components/index: BulkAccount export ensured (ZedAuthModal from global kept)"

Write-Host "=== [4/6] Merge: capabilities + next.config + package.json + testUtils ===" -ForegroundColor Cyan
Copy-GlobalFile 'open-sse\providers\capabilities.js'
$cap = Join-Path $local 'open-sse\providers\capabilities.js'
$capRouteway = @'
  // Local custom: Routeway / Infron / Empero Free (OpenAI-compatible free tiers).
  "routeway": {
    "deepseek-v4-flash:free": { vision: false, tools: true, reasoning: true, contextWindow: 42000 },
    "minimax-m2.7:free": { vision: false, tools: true, reasoning: true, contextWindow: 42000 },
    "muse-glimmer-30b:free": { vision: true, tools: true, reasoning: true, contextWindow: 131072 },
  },
  "infron": {
    "qwen/qwen3.8-flash:free": { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1048576, maxOutput: 65536 },
    "deepseek/deepseek-v4-flash-0731:free": { reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
    "qwen/qwen3.8-27b:free": { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 32768, maxOutput: 32768 },
    "qwen/qwen3.8-27b-abliterated-cyber:free": { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 32768, maxOutput: 32768 },
    "deepseek/deepseek-v4.1-flash:free": { vision: true, reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 },
    "deepseek/deepseek-v4-flash:free": { reasoning: true, thinkingFormat: "deepseek", thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 384000 },
  },
  "empero-free": {
    "Qwen/Qwen3.8-27B-FP8": { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 32768, maxOutput: 32768 },
  },
'@
$cc = Get-Content -LiteralPath $cap -Raw
if (!$cc.Contains('"routeway"')) {
  $anchor = '    "deepseek-ai/deepseek-v4-flash": { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 65536 },'
  $cc = $cc.Replace($anchor, $anchor + "`r`n" + $capRouteway.TrimEnd())
  Set-Content -LiteralPath $cap -Value $cc -Encoding UTF8
}
$agnesBlock = @'
  // Local custom: Agnes (global + CN) — OpenAI-compatible, OpenAI-style reasoning_effort.
  "agnes-ai": {
    "agnes-3.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-pro":       { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-alpha": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-beta":  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 64000 },
    "agnes-image-2.5-flash": { imageOutput: true },
    "agnes-image-2.1-flash": { imageOutput: true },
    "agnes-image-2.0-flash": { imageOutput: true },
  },
  "agnes-ai-cn": {
    "agnes-3.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-pro":       { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-alpha": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-beta":  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 64000 },
    "agnes-image-2.5-flash": { imageOutput: true },
    "agnes-image-2.1-flash": { imageOutput: true },
    "agnes-image-2.0-flash": { imageOutput: true },
  },
  "model": {
    "agnes-3.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-pro":       { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-alpha": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-beta":  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 64000 },
    "agnes-image-2.5-flash": { imageOutput: true },
    "agnes-image-2.1-flash": { imageOutput: true },
    "agnes-image-2.0-flash": { imageOutput: true },
  },
  // Agnes aliases (used in "provider/model" strings from routedModel/fullModel)
  "agnes": {
    "agnes-3.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-pro":       { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-alpha": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-beta":  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 64000 },
    "agnes-image-2.5-flash": { imageOutput: true },
    "agnes-image-2.1-flash": { imageOutput: true },
    "agnes-image-2.0-flash": { imageOutput: true },
  },
  "agnes-cn": {
    "agnes-3.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 },
    "agnes-2.5-pro":       { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-alpha": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.5-pro-beta":  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 },
    "agnes-2.0-flash":     { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 64000 },
    "agnes-image-2.5-flash": { imageOutput: true },
    "agnes-image-2.1-flash": { imageOutput: true },
    "agnes-image-2.0-flash": { imageOutput: true },
  },
'@
$cc = Get-Content -LiteralPath $cap -Raw
if (!$cc.Contains('"agnes-ai"')) {
  $anchor2 = '    "deepseek-v4.1-flash:cloud": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },'
  if ($cc.Contains($anchor2)) {
    $cc = $cc.Replace($anchor2, $anchor2 + "`r`n" + $agnesBlock.TrimEnd())
    Set-Content -LiteralPath $cap -Value $cc -Encoding UTF8
  } else { Write-Host "  WARN: ollama anchor not found for agnes blocks" -ForegroundColor Yellow }
}
$agnesPat = @'
  // Local custom: Agnes (Global + CN) — also matches bare model ids when provider is null
  { pattern: "*agnes-3.0-flash*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 } },
  { pattern: "*agnes-2.5-flash*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 524288, maxOutput: 65536 } },
  { pattern: "*agnes-2.5-pro*",   caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*agnes-2.0-flash*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 64000 } },
  { pattern: "*agnes*image*",     caps: { imageOutput: true } },
'@
$cc = Get-Content -LiteralPath $cap -Raw
if (!$cc.Contains('*agnes-3.0-flash*')) {
  $anchor3 = '{ pattern: "*glm*",           caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },'
  if ($cc.Contains($anchor3)) {
    $cc = $cc.Replace($anchor3, $anchor3 + "`r`n" + $agnesPat.TrimEnd())
    Set-Content -LiteralPath $cap -Value $cc -Encoding UTF8
  } else { Write-Host "  WARN: glm anchor not found for agnes patterns" -ForegroundColor Yellow }
}
Write-Host "  capabilities: custom blocks ensured"

Copy-GlobalFile 'next.config.mjs'
$nc = Join-Path $local 'next.config.mjs'
$ncContent = Get-Content -LiteralPath $nc -Raw
if (!$ncContent.Contains('camoufox-js')) {
  if ($ncContent -match 'serverExternalPackages:\s*\[(.*?)\]') {
    $existing = $matches[1].Trim().TrimEnd(',')
    $ncContent = $ncContent.Replace($matches[0], "serverExternalPackages: [$existing, `"camoufox-js`", `"impit`", `"playwright`"]")
  } else {
    $ncContent = $ncContent.Replace('serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open"]', 'serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open", "camoufox-js", "impit", "playwright"]')
  }
  Set-Content -LiteralPath $nc -Value $ncContent -Encoding UTF8
}
Write-Host "  next.config: camoufox/impit/playwright externals ensured (systemone rewrite from global kept)"

Copy-GlobalFile 'package.json'
$pj = Get-Content -LiteralPath (Join-Path $local 'package.json') -Raw | ConvertFrom-Json
if (!$pj.dependencies.PSObject.Properties['playwright']) { $pj.dependencies | Add-Member -NotePropertyName 'playwright' -NotePropertyValue '^1.63.0' }
if (!$pj.dependencies.PSObject.Properties['camoufox-js']) { $pj.dependencies | Add-Member -NotePropertyName 'camoufox-js' -NotePropertyValue '^0.12.0' }
$pj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $local 'package.json') -Encoding UTF8
Write-Host "  package.json: v$($pj.version) + playwright/camoufox kept"

Copy-GlobalFile 'src\app\api\providers\[id]\test\testUtils.js'
$tu = Join-Path $local 'src\app\api\providers\[id]\test\testUtils.js'
$tuContent = Get-Content -LiteralPath $tu -Raw
if (!$tuContent.Contains('"agnes-ai"')) {
  $tuContent = $tuContent.Replace('      case "agnes":', '      case "agnes":' + "`r`n" + '      // Local custom providers — same generic validateUrl probe as the aggregators above.' + "`r`n" + '      case "agnes-ai":' + "`r`n" + '      case "agnes-ai-cn":' + "`r`n" + '      case "routeway":' + "`r`n" + '      case "infron":' + "`r`n" + '      case "empero-free":')
  Set-Content -LiteralPath $tu -Value $tuContent -Encoding UTF8
}
Write-Host "  testUtils: custom provider probe ensured"

Write-Host "=== [5/6] Verify ===" -ForegroundColor Cyan
node --check (Join-Path $local 'open-sse\providers\capabilities.js')
node --check (Join-Path $local 'open-sse\providers\registry\index.js')
node --check (Join-Path $local 'src\shared\components\Sidebar.js')
node --check (Join-Path $local 'src\shared\components\index.js')
$checks = @(
  'src\app\(dashboard)\dashboard\automation\page.js',
  'src\shared\components\BulkAccountAutomationModal.js',
  'open-sse\providers\registry\agnes-ai.js',
  'open-sse\providers\registry\agnes-ai-cn.js',
  'open-sse\providers\registry\infron.js',
  'open-sse\providers\registry\empero-free.js',
  'open-sse\providers\registry\routeway.js',
  'src\sse\services\model.js'
)
$ok = 0
foreach ($f in $checks) { if (Test-Path -LiteralPath (Join-Path $local $f)) { $ok++ } else { Write-Host "  MISSING: $f" -ForegroundColor Red } }
Write-Host "  $ok/$($checks.Count) custom files present"

Write-Host "=== [6/6] npm install (build manually) ===" -ForegroundColor Cyan
Set-Location $local
$prevErr = $ErrorActionPreference; $ErrorActionPreference = "Continue"
npm install 2>&1 | Select-Object -Last 3
$ErrorActionPreference = $prevErr

Write-Host "`n=== DONE: v$gver ===" -ForegroundColor Green
Write-Host "Next: npm run build  (stop the running server first to avoid EBUSY on .next/standalone)"
Write-Host "Then: cd .next\standalone && set PORT=20128 && node custom-server.js"
