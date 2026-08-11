# JPEG 한 장을 긴 변 기준 $Size 로 줄인다 (shrink-textures.mjs 가 부른다).
# Windows 기본 GDI+ 만 쓴다 — 별도 설치가 필요 없다.
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Size = 1024,
  [int]$Quality = 88
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile($In)
try {
  $long = [Math]::Max($src.Width, $src.Height)
  $k = if ($long -gt $Size) { $Size / $long } else { 1 }
  $w = [Math]::Max(1, [int][Math]::Round($src.Width * $k))
  $h = [Math]::Max(1, [int][Math]::Round($src.Height * $k))

  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      # 4096 → 1024 처럼 크게 줄일 때 계단이 지지 않도록 고품질 경로로 고정
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.DrawImage($src, 0, 0, $w, $h)
    } finally { $g.Dispose() }

    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    try { $bmp.Save($Out, $codec, $ep) } finally { $ep.Dispose() }
  } finally { $bmp.Dispose() }
} finally { $src.Dispose() }

Write-Output "$w x $h"
