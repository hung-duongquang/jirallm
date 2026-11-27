import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFFICE_NOT_SUPPORTED, parseOfficeLink } from './sharepointOffice.js';
import { SharePointClient, SharePointSessionError, hasSharePointAuth, loadSharePointAuth } from './sharepoint.js';
import { expectations, waitForServerContent } from './sharepointServerCheck.js';
export function validateEdits(input) {
    const list = Array.isArray(input) ? input : [input];
    if (!list.length)
        throw new Error('No edits given.');
    return list.map((e, i) => {
        const where = `edit ${i + 1}`;
        const slide = e?.slide === undefined || e?.slide === null ? undefined : Number(e.slide);
        if (slide !== undefined && (!Number.isInteger(slide) || slide < 1))
            throw new Error(`${where}: slide must be a slide number (1, 2, …)`);
        if (typeof e?.find === 'string') {
            if (!e.find)
                throw new Error(`${where}: find is empty`);
            if (typeof e.replace !== 'string')
                throw new Error(`${where}: find needs replace (a string, may be empty)`);
            return { slide, find: e.find, replace: e.replace };
        }
        if (slide === undefined)
            throw new Error(`${where}: shape and notes edits need a slide number`);
        if (typeof e?.shape === 'string') {
            if (typeof e.text !== 'string')
                throw new Error(`${where}: shape needs text`);
            return { slide, shape: e.shape, text: e.text };
        }
        if (typeof e?.notes === 'string')
            return { slide, notes: e.notes };
        throw new Error(`${where}: expected {slide, shape, text}, {slide, notes} or {slide?, find, replace}`);
    });
}
/**
 * -Edits: JSON list of edits. -Out: JSON results. Every target is resolved first; one that is not
 * found fails the whole run before anything changes. With -DryRun nothing is changed at all
 * (cloud files AutoSave, so "change and do not save" is not safe).
 */
export const OFFICE_EDIT_PS1 = String.raw `
param([string]$Url, [string]$Edits, [string]$Out, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$CR = [string][char]13
$LF = [string][char]10
function Clean($s) { if ($null -eq $s) { '' } else { ([string]$s) -replace "\v", $LF } }
function AllShapes($slide) {
  $q = New-Object System.Collections.Queue; $all = @()
  foreach ($sh in $slide.Shapes) { $q.Enqueue($sh) }
  while ($q.Count -gt 0) { $sh = $q.Dequeue(); if ($sh.Type -eq 6) { foreach ($g in $sh.GroupItems) { $q.Enqueue($g) } } else { $all += $sh } }
  ,$all
}
function NotesShape($slide) { foreach ($n in $slide.NotesPage.Shapes) { try { if ($n.Type -eq 14 -and $n.PlaceholderFormat.Type -eq 2) { return $n } } catch {} }; $null }
function SetParas($tr, [string]$text) {
  $new = @($text -replace "\r\n", $LF -split $LF)
  $oldText = [string]$tr.Text
  $oldN = if ($oldText.Length -eq 0) { 0 } else { @($oldText -split $CR).Count }
  if ($oldN -eq 0) { $tr.Text = ($new -join $CR); return }
  $common = [Math]::Min($oldN, $new.Count)
  for ($i = 1; $i -le $common; $i++) {
    $p = $tr.Paragraphs($i, 1)
    $len = $p.Length
    if ($p.Text.EndsWith($CR)) { $len-- }
    if ($len -gt 0) { $p.Characters(1, $len).Text = $new[$i - 1] } elseif ($new[$i - 1]) { $p.InsertBefore($new[$i - 1]) | Out-Null }
  }
  if ($new.Count -gt $oldN) { $tr.InsertAfter($CR + ($new[$oldN..($new.Count - 1)] -join $CR)) | Out-Null }
  elseif ($new.Count -lt $oldN) { $s = $tr.Paragraphs($new.Count + 1, 1).Start; $tr.Characters($s - 1, $tr.Length - $s + 2).Delete() }
}
function CountOf([string]$hay, [string]$needle) { $n = 0; $i = 0; while (($i = $hay.IndexOf($needle, $i, [StringComparison]::Ordinal)) -ge 0) { $n++; $i += $needle.Length }; $n }

# Windows PowerShell's ConvertFrom-Json emits an array as one object; piping it again unrolls it.
$list = @((Get-Content -Raw -Encoding UTF8 $Edits | ConvertFrom-Json) | ForEach-Object { $_ })
$running = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$app = New-Object -ComObject PowerPoint.Application
$results = @()
$wasOpen = $false
$applied = $false
try {
  $before = @(foreach ($q in $app.Presentations) { $q.FullName })
  # A real, visible open (like double-clicking the file), so PowerPoint's own save uploads to SharePoint.
  # ReadOnly = false, Untitled = false, WithWindow = true
  $p = $app.Presentations.Open($Url, 0, 0, -1)
  $fullName = $p.FullName
  if ($before -contains $fullName) {
    # Already open in the user's PowerPoint: edit that window, so the change shows there and AutoSave carries it.
    $wasOpen = $true
    $editable = @(foreach ($q in $app.Presentations) { if ($q.FullName -eq $fullName -and -not $q.ReadOnly) { $q } })
    if ($p.ReadOnly -and $editable.Count) { $p.Close(); $p = $editable[0] }
  }
  try {
    if ($p.ReadOnly) { throw 'The deck opened read-only (no edit rights, or it is checked out / locked by someone else).' }
    $count = $p.Slides.Count
    # 1. Resolve every target before changing anything.
    $plan = @()
    foreach ($e in $list) {
      if ($null -ne $e.slide -and ($e.slide -lt 1 -or $e.slide -gt $count)) { throw "Slide $($e.slide) does not exist (the deck has $count slides)." }
      if ($null -ne $e.find) {
        $slides = if ($null -ne $e.slide) { @($p.Slides.Item([int]$e.slide)) } else { @($p.Slides) }
        $hits = @(); $total = 0
        foreach ($s in $slides) { foreach ($sh in (AllShapes $s)) { if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $c = CountOf ([string]$sh.TextFrame.TextRange.Text) $e.find; if ($c) { $hits += $sh; $total += $c } } } }
        if ($total -eq 0) { throw "Text not found$(if ($null -ne $e.slide) { " on slide $($e.slide)" }): $($e.find)" }
        $plan += @{ e = $e; kind = 'find'; shapes = $hits; count = $total }
        continue
      }
      $slide = $p.Slides.Item([int]$e.slide)
      if ($null -ne $e.notes) {
        $n = NotesShape $slide
        if ($null -eq $n) { throw "Slide $($e.slide) has no notes placeholder." }
        $plan += @{ e = $e; kind = 'notes'; shape = $n; before = (Clean $n.TextFrame.TextRange.Text) -replace $CR, $LF }
        continue
      }
      $match = @((AllShapes $slide) | Where-Object { $_.Name -eq $e.shape })
      if ($match.Count -eq 0) { throw "Slide $($e.slide) has no shape named '$($e.shape)'. Names: $(((AllShapes $slide) | Where-Object { $_.HasTextFrame } | ForEach-Object { $_.Name }) -join ', ')" }
      if ($match.Count -gt 1) { throw "Slide $($e.slide) has $($match.Count) shapes named '$($e.shape)'." }
      if (-not $match[0].HasTextFrame) { throw "Shape '$($e.shape)' on slide $($e.slide) holds no text." }
      $plan += @{ e = $e; kind = 'shape'; shape = $match[0]; before = (Clean $match[0].TextFrame.TextRange.Text) -replace $CR, $LF }
    }
    # 2. Apply.
    $applied = $true
    foreach ($x in $plan) {
      $e = $x.e
      if ($x.kind -eq 'find') {
        if (-not $DryRun) {
          # Only the part that differs is rewritten (common prefix and suffix stay), so mixed formatting
          # in a match survives: "Presenter: Hung" -> "Presenter: Hung Duong" only inserts " Duong".
          $a = [string]$e.find; $b = [string]$e.replace
          $pre = 0; while ($pre -lt $a.Length -and $pre -lt $b.Length -and $a[$pre] -ceq $b[$pre]) { $pre++ }
          $suf = 0; while ($suf -lt ($a.Length - $pre) -and $suf -lt ($b.Length - $pre) -and $a[$a.Length - 1 - $suf] -ceq $b[$b.Length - 1 - $suf]) { $suf++ }
          $mid = $b.Substring($pre, $b.Length - $pre - $suf)
          $cut = $a.Length - $pre - $suf
          foreach ($sh in $x.shapes) {
            $tr = $sh.TextFrame.TextRange; $guard = 0; $after = 0
            while ($guard -lt 200) {
              # Find(FindWhat, After, MatchCase = true, WholeWords = false)
              $f = $tr.Find($a, $after, -1, 0)
              if ($null -eq $f) { break }
              $start = $f.Start
              if ($cut -gt 0) { $tr.Characters($start + $pre, $cut).Text = $mid }
              elseif ($mid) { if ($pre -gt 0) { $tr.Characters($start + $pre - 1, 1).InsertAfter($mid) | Out-Null } else { $tr.Characters($start, 1).InsertBefore($mid) | Out-Null } }
              $after = $start - 1 + $b.Length; $guard++
            }
          }
        }
        $results += @{ slide = $e.slide; target = 'find'; before = $e.find; after = $e.replace; count = $x.count }
        continue
      }
      $text = if ($x.kind -eq 'notes') { [string]$e.notes } else { [string]$e.text }
      if (-not $DryRun) { SetParas $x.shape.TextFrame.TextRange $text }
      $results += @{ slide = $e.slide; target = $(if ($x.kind -eq 'notes') { 'notes' } else { "shape:$($e.shape)" }); before = $x.before; after = ($text -replace "\r\n", $LF) }
    }
    if (-not $DryRun) { $p.Save() }
  } finally {
    if (($DryRun -or -not $applied) -and -not $wasOpen) { $p.Close() }
  }
  # Save() through COM only reaches the Office Document Cache; staying open, closing, or quitting
  # did not upload it (seen 2026-11-05: still on the old server version after 5 minutes). Opening
  # the document again does: PowerPoint reconciles its cache with SharePoint on open. So close, open
  # again in a window, and leave it open; the caller then checks SharePoint itself.
  if ($applied -and -not $DryRun -and -not $wasOpen) {
    $p.Close()
    $p = $app.Presentations.Open($fullName, 0, 0, -1)
  }
} finally { if (-not $running -and $app.Presentations.Count -eq 0) { $app.Quit() } }
$report = @{ wasOpen = $wasOpen; fullName = $fullName; results = @($results) }
[IO.File]::WriteAllText($Out, (ConvertTo-Json $report -Depth 6 -Compress), (New-Object System.Text.UTF8Encoding $false))
`;
function runPowerShell(args, timeoutMs) {
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (!err)
                return resolve();
            const detail = stderr.replace(/\s+/g, ' ').trim();
            // PowerShell wraps a thrown string in its error record; keep the message itself.
            const message = /^(.*?) At .*?\.ps1:\d+/.exec(detail)?.[1] ?? detail.slice(0, 600);
            if (/80040154|Class not registered|COM class factory/i.test(detail))
                return reject(new Error(OFFICE_NOT_SUPPORTED));
            reject(new Error(`Edit failed (check the deck in PowerPoint before retrying): ${message || err.message}`));
        });
    });
}
/**
 * Applies the edits in a visible PowerPoint window and saves; the deck stays open so PowerPoint can
 * finish uploading. Then checks SharePoint itself (not Office's cache): it waits until the server's
 * copy holds every changed line (and, for find edits, no longer the old text). With `dryRun`, only checks the targets.
 */
export async function editPowerPoint(url, edits, opts = {}) {
    const link = parseOfficeLink(url);
    if (!link)
        throw new Error(`Not a SharePoint Office document link: ${url}`);
    if (link.kind !== 'powerpoint')
        throw new Error(`Only PowerPoint decks can be edited (this link is ${link.kind}).`);
    if (!opts.run && process.platform !== 'win32')
        throw new Error(OFFICE_NOT_SUPPORTED);
    const temp = mkdtempSync(join(tmpdir(), 'jirallm-office-edit-'));
    let report;
    try {
        const script = join(temp, 'edit.ps1');
        const editsPath = join(temp, 'edits.json');
        const out = join(temp, 'out.json');
        writeFileSync(script, '\uFEFF' + OFFICE_EDIT_PS1);
        writeFileSync(editsPath, JSON.stringify(edits));
        const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Url', url, '-Edits', editsPath, '-Out', out];
        if (opts.dryRun)
            args.push('-DryRun');
        await (opts.run ? opts.run(args) : runPowerShell(args, opts.timeoutMs ?? 240_000));
        report = parseEditReport(JSON.parse(readFileSync(out, 'utf8').replace(/^\uFEFF/, '')));
    }
    finally {
        rmSync(temp, { recursive: true, force: true });
    }
    if (opts.dryRun)
        return report;
    let client = opts.client;
    if (client === undefined)
        client = (await hasSharePointAuth()) ? new SharePointClient(await loadSharePointAuth(report.fullName)) : null;
    if (!client)
        return { ...report, server: { status: 'unchecked', message: 'no SharePoint session; `jirallm sharepoint:auth` enables the check' } };
    const timeoutMs = opts.verifyTimeoutMs ?? 120_000;
    try {
        const check = await waitForServerContent(client, report.fullName, expectations(report.results), { timeoutMs, sleep: opts.sleep });
        const results = report.results.map((r, i) => ({ ...r, verified: check.verified[i] }));
        const server = !check.timedOut && check.info
            ? { status: 'verified', version: check.info.version, modified: check.info.modified }
            : { status: 'pending', version: check.info?.version, modified: check.info?.modified, waitedSeconds: Math.round(timeoutMs / 1000) };
        return { ...report, results, server };
    }
    catch (err) {
        if (err instanceof SharePointSessionError)
            return { ...report, server: { status: 'unchecked', message: err.message } };
        throw err;
    }
}
export function parseEditReport(raw) {
    const list = raw?.results === undefined || raw?.results === null ? [] : Array.isArray(raw.results) ? raw.results : [raw.results];
    return {
        wasOpen: Boolean(raw?.wasOpen),
        fullName: String(raw?.fullName ?? ''),
        results: list.map((r) => ({
            slide: r.slide === undefined || r.slide === null ? null : Number(r.slide),
            target: String(r.target),
            before: String(r.before ?? ''),
            after: String(r.after ?? ''),
            ...(r.count !== undefined ? { count: Number(r.count) } : {}),
        })),
    };
}
/** A change that did not (yet) reach SharePoint is a failure for the CLI's exit code. */
export function editNeedsAttention(report) {
    return report.server?.status === 'pending';
}
export function describeEditResults(report, dryRun) {
    const lines = [];
    for (const r of report.results) {
        const where = r.slide ? `slide ${r.slide}` : 'all slides';
        const check = r.verified === undefined ? '' : r.verified ? ' ✓ on SharePoint' : ' ✗ not on SharePoint yet';
        if (r.target === 'find') {
            lines.push(`${where}: "${r.before}" → "${r.after}" (${r.count} time(s))${check}`);
            continue;
        }
        lines.push(`${where} ${r.target === 'notes' ? 'notes' : r.target.replace(/^shape:/, '')}:${check}`);
        if (r.before === r.after) {
            lines.push('  (unchanged)');
            continue;
        }
        for (const l of r.before.split('\n'))
            lines.push(`  - ${l}`);
        for (const l of r.after.split('\n'))
            lines.push(`  + ${l}`);
    }
    if (dryRun || !report.server) {
        lines.push('Dry run: nothing changed.');
        return lines.join('\n');
    }
    const where = report.wasOpen ? 'in your open PowerPoint window' : 'in PowerPoint (the deck stays open there)';
    const s = report.server;
    if (s.status === 'verified')
        lines.push(`Saved ${where}; SharePoint has every change (version ${s.version}, ${s.modified}).`);
    else if (s.status === 'pending')
        lines.push(`Saved ${where}, but after ${s.waitedSeconds} s SharePoint does not have every change (server version ${s.version ?? '?'}, ${s.modified ?? '?'}). ` +
            'PowerPoint uploads a stuck change when the deck is opened again: close the deck, open it from SharePoint, then check the browser.');
    else
        lines.push(`Saved ${where}; the upload to SharePoint was not checked (${s.message}). Keep PowerPoint open until it has uploaded.`);
    lines.push(report.fullName);
    return lines.join('\n');
}
//# sourceMappingURL=sharepointOfficeEdit.js.map