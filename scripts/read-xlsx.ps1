param([Parameter(Mandatory = $true)][string]$Path)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
try {
    function Read-Entry([string]$Name) {
        $entry = $archive.GetEntry($Name)
        if (-not $entry) { return $null }
        $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    }

    $shared = @()
    $sharedXml = Read-Entry 'xl/sharedStrings.xml'
    if ($sharedXml) {
        [xml]$doc = $sharedXml
        $ns = [System.Xml.XmlNamespaceManager]::new($doc.NameTable)
        $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
        foreach ($item in $doc.SelectNodes('//x:si', $ns)) {
            $parts = $item.SelectNodes('./x:t | ./x:r/x:t', $ns) | ForEach-Object { $_.'#text' }
            $shared += ($parts -join '')
        }
    }

    [xml]$workbook = Read-Entry 'xl/workbook.xml'
    [xml]$rels = Read-Entry 'xl/_rels/workbook.xml.rels'
    $bookNs = [System.Xml.XmlNamespaceManager]::new($workbook.NameTable)
    $bookNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $bookNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $relMap = @{}
    foreach ($rel in $rels.Relationships.Relationship) { $relMap[$rel.Id] = $rel.Target }

    foreach ($sheet in $workbook.SelectNodes('//x:sheets/x:sheet', $bookNs)) {
        $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $target = $relMap[$rid]
        if ($target -notmatch '^xl/') { $target = 'xl/' + $target.TrimStart('/') }
        [xml]$sheetXml = Read-Entry $target
        $sheetNs = [System.Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
        $sheetNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
        Write-Output ("### SHEET: " + $sheet.name)
        foreach ($row in $sheetXml.SelectNodes('//x:sheetData/x:row', $sheetNs)) {
            $values = foreach ($cell in $row.SelectNodes('./x:c', $sheetNs)) {
                $ref = $cell.r
                $type = $cell.t
                if ($type -eq 'inlineStr') {
                    $value = (($cell.SelectNodes('./x:is/x:t | ./x:is/x:r/x:t', $sheetNs) | ForEach-Object { $_.'#text' }) -join '')
                } else {
                    $value = $cell.v
                    if ($type -eq 's' -and $null -ne $value) { $value = $shared[[int]$value] }
                }
                [pscustomobject]@{ Cell = $ref; Value = [string]$value }
            }
            [pscustomobject]@{ Row = [int]$row.r; Cells = @($values) } | ConvertTo-Json -Compress -Depth 4
        }
    }
} finally {
    $archive.Dispose()
}
