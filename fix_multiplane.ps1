# PowerShell script to fix multi-plane sequence issues
$filePath = "c:\Users\matul\OneDrive\Patrick\Personal\Documents\avg-hounsfield.github.io\data\protocols.json"
$content = Get-Content $filePath -Raw

Write-Host "Fixing multi-plane sequence formatting..."

# Fix patterns like "AX T1, COR, SAG" -> "AX, COR, SAG T1"
$multiPlanePatterns = @(
    # Pattern: "AX SEQUENCE, COR, SAG" -> "AX, COR, SAG SEQUENCE"
    '("sequence": ")(AX|COR|SAG) ([^,]+), ((?:AX|COR|SAG)(?:, (?:AX|COR|SAG))*?)(")'
    # Pattern: "AX SEQUENCE, COR" -> "AX, COR SEQUENCE" 
    '("sequence": ")(AX|COR|SAG) ([^,]+), (AX|COR|SAG)(")'
)

foreach ($pattern in $multiPlanePatterns) {
    $regexMatches = [regex]::Matches($content, $pattern)
    Write-Host "Pattern: $pattern - Found $($regexMatches.Count) matches"
    
    if ($regexMatches.Count -gt 0) {
        # Use a more specific replacement for each match
        $content = [regex]::Replace($content, $pattern, { 
            param($match)
            $prefix = $match.Groups[1].Value
            $firstPlane = $match.Groups[2].Value
            $sequence = $match.Groups[3].Value
            $otherPlanes = $match.Groups[4].Value
            $suffix = $match.Groups[5].Value
            
            return "$prefix$firstPlane, $otherPlanes $sequence$suffix"
        })
    }
}

# Write the updated content back to file
Set-Content -Path $filePath -Value $content -NoNewline

Write-Host "Multi-plane sequence fix complete!"
