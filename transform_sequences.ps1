# PowerShell script to transform sequence formats
# Transform "SEQUENCE: PLANE" to "PLANE SEQUENCE"

$filePath = "c:\Users\matul\OneDrive\Patrick\Personal\Documents\avg-hounsfield.github.io\data\protocols.json"
$content = Get-Content $filePath -Raw

# Define transformation patterns
$patterns = @(
    # Simple patterns like "T1: SAG" -> "SAG T1"
    @{from = '("sequence": ")([^:]+): (AX|COR|SAG)([^"]*")'  ; to = '$1$3 $2$4'}
    
    # Patterns with multiple planes like "T1: AX, COR" -> "AX, COR T1"
    @{from = '("sequence": ")([^:]+): ((?:AX|COR|SAG)(?:, (?:AX|COR|SAG))*?)([^"]*")'  ; to = '$1$3 $2$4'}
    
    # Patterns with complex descriptions like "T1 (2 FOV): SAG" -> "SAG T1 (2 FOV)"
    @{from = '("sequence": ")([^:]+\([^)]+\)): ((?:AX|COR|SAG)(?:, (?:AX|COR|SAG))*?)([^"]*")'  ; to = '$1$3 $2$4'}
    
    # Patterns like "T1 THRU ANY LESIONS: AX" -> "AX T1 THRU ANY LESIONS"
    @{from = '("sequence": ")([^:]+[A-Z\s]+): ((?:AX|COR|SAG)(?:, (?:AX|COR|SAG))*?)([^"]*")'  ; to = '$1$3 $2$4'}
)

Write-Host "Processing sequence transformations..."

foreach ($pattern in $patterns) {
    $matches = [regex]::Matches($content, $pattern.from)
    Write-Host "Pattern: $($pattern.from) - Found $($matches.Count) matches"
    
    if ($matches.Count -gt 0) {
        $content = $content -replace $pattern.from, $pattern.to
    }
}

# Write the updated content back to file
Set-Content -Path $filePath -Value $content -NoNewline

Write-Host "Transformation complete!"
