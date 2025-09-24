$URL = "https://odds-backend-gpt.onrender.com"
$KEY = "YOUR_PUBLIC_API_KEY"

# Free / local
Invoke-RestMethod "$URL/api/health"
Invoke-RestMethod "$URL/" | ConvertTo-Json

# Upstream (shows usage)
$scan = Invoke-RestMethod "$URL/api/gpt/scan?sport=mlb&limit=1" -Headers @{ "x-api-key" = $KEY }
$scan.usage

$EVENT = $scan.events[0].id
$mkts = Invoke-RestMethod "$URL/api/gpt/markets?sport=mlb&eventId=$EVENT&markets=h2h,spreads,totals" -Headers @{ "x-api-key" = $KEY }
$mkts.usage

# Preset + props
$props = Invoke-RestMethod "$URL/api/gpt/markets/preset?sport=mlb&eventId=$EVENT&preset=props_basic" -Headers @{ "x-api-key" = $KEY }
$props.usage

# Parlay (local math)
Invoke-RestMethod "$URL/api/gpt/parlay/price?format=american&legs=-110,-105,120" -Headers @{ "x-api-key" = $KEY } | Select-Object usage

