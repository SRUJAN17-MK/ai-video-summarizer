# Generates test videos used by scripts/e2e.mjs
#   testdata/sample-speech.mp4 - spoken narration mixed with background tone (music-like interference)
#   testdata/sample-silent.mp4 - background tone only, no speech
param(
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'testdata')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ffmpeg = Join-Path $root 'node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$speechWav = Join-Path $OutDir 'speech.wav'
$musicWav = Join-Path $OutDir 'music.wav'

$text = 'Welcome to the AI Video Summarizer demonstration. ' +
        'In this short video we explain how electric vehicles work. ' +
        'Electric vehicles use battery powered motors instead of petrol engines. ' +
        'They produce no direct exhaust emissions, which makes them better for city air quality. ' +
        'Charging infrastructure is the most important factor for wide adoption. ' +
        'Battery technology continues to improve and prices keep falling. ' +
        'Governments in many countries offer incentives to encourage buyers to switch. ' +
        'Overall, electric vehicles have clear advantages over traditional petrol vehicles.'

Add-Type -AssemblyName System.Speech
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synthesizer.SelectVoice('Microsoft David Desktop')
$synthesizer.Rate = 0
$synthesizer.SetOutputToWaveFile($speechWav)
$synthesizer.Speak($text)
$synthesizer.Dispose()
Write-Output "speech.wav written"

# Background 'music': layered tones with a slow pulse.
& $ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i 'sine=frequency=330:duration=30' `
    -f lavfi -i 'sine=frequency=494:duration=30' `
    -filter_complex '[0:a]volume=0.35[a0];[1:a]volume=0.22[a1];[a0][a1]amix=inputs=2,afade=t=in:st=0:d=1,afade=t=out:st=28:d=2[out]' `
    -map '[out]' -c:a pcm_s16le $musicWav
if ($LASTEXITCODE -ne 0) { throw 'music generation failed' }
Write-Output "music.wav written"

$speechMp4 = Join-Path $OutDir 'sample-speech.mp4'
& $ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i 'testsrc=size=640x360:rate=15' `
    -i $speechWav `
    -i $musicWav `
    -filter_complex '[1:a]volume=1.0[speech];[2:a]volume=0.18[music];[speech][music]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[a]' `
    -map 0:v -map '[a]' `
    -c:v libx264 -preset veryfast -pix_fmt yuv420p `
    -c:a aac -b:a 160k `
    -shortest $speechMp4
if ($LASTEXITCODE -ne 0) { throw 'sample-speech.mp4 generation failed' }
Write-Output "sample-speech.mp4 written"

$silentMp4 = Join-Path $OutDir 'sample-silent.mp4'
& $ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i 'testsrc=size=640x360:rate=15:duration=5' `
    -f lavfi -i 'sine=frequency=200:duration=5' `
    -map 0:v -map 1:a `
    -c:v libx264 -preset veryfast -pix_fmt yuv420p `
    -c:a aac -b:a 128k `
    $silentMp4
if ($LASTEXITCODE -ne 0) { throw 'sample-silent.mp4 generation failed' }
Write-Output "sample-silent.mp4 written (music only)"

# Digital silence - used to verify the "no speech detected" pipeline path.
$silenceMp4 = Join-Path $OutDir 'sample-silence.mp4'
& $ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i 'testsrc=size=640x360:rate=15:duration=5' `
    -f lavfi -i 'anullsrc=r=44100:cl=stereo' `
    -map 0:v -map 1:a -shortest `
    -c:v libx264 -preset veryfast -pix_fmt yuv420p `
    -c:a aac -b:a 128k `
    $silenceMp4
if ($LASTEXITCODE -ne 0) { throw 'sample-silence.mp4 generation failed' }
Write-Output "sample-silence.mp4 written (digital silence)"

Get-ChildItem $OutDir | Select-Object Name, Length
