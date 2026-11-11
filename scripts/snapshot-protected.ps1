$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$files = @(
  'server.ts',
  'DUPLICATE_PREVENTION.md',
  'vercel.json',
  'Makefile',
  'src/lib/crypto.ts',
  'src/lib/crypto.test.ts',
  'src/lib/classifier.ts',
  'src/lib/classifier.test.ts',
  'src/lib/fuzzy.ts',
  'src/lib/fuzzy.test.ts',
  'src/lib/funnel.ts',
  'src/lib/funnel.test.ts',
  'src/lib/problemLabels.ts',
  'src/lib/ledgerEngine.ts',
  'src/lib/ledgerEngine.test.ts',
  'requirements.txt',
  'requirements-dev.txt'
)
foreach ($dir in @('backend', 'supabase', 'sample_data')) {
  if (Test-Path $dir) {
    $files += Get-ChildItem -Recurse -File $dir | ForEach-Object {
      $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    }
  }
}
$files += Get-ChildItem -File .env* -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
$map = [ordered]@{}
foreach ($f in ($files | Select-Object -Unique)) {
  if (Test-Path -LiteralPath $f) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
    $map[$f.Replace('\', '/')] = $hash
  }
}
New-Item -ItemType Directory -Force -Path scripts | Out-Null
($map | ConvertTo-Json) | Set-Content -Encoding UTF8 'scripts/.protected-baseline.json'
Write-Output ("COUNT=" + $map.Count)
Get-Content 'scripts/.protected-baseline.json'
