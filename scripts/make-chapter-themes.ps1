# Rebuild the planned chapter artwork and theme packs. Original themes are never modified.
$ErrorActionPreference = 'Stop'
$themeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../themes'))
$chapters = @(
  @(2, 'desert', 'Hot Hot Ruin', '#f5bb58', '#c55d36', '#291b22', 'slant', 'diamond', 'diagonal', 'Sun-baked sandstone, buried gates and heat shimmering over ancient ruins.'),
  @(3, 'wood', 'Chop Chop Sawmill', '#dbb580', '#69834c', '#241e19', 'ring', 'circle', 'stripes', 'Cut timber, spinning saws and moss-green machinery deep in the forest.'),
  @(4, 'botany', 'Realm of the Wicked Bulbs', '#b5e965', '#b759b8', '#142c27', 'ring', 'leaf', 'dots', 'A moonlit greenhouse of luminous bulbs, curling roots and poisonous blooms.'),
  @(5, 'frost', 'Eternal Frost', '#b6ecff', '#6e92dd', '#17283e', 'emblem', 'diamond', 'diagonal', 'Frozen spires, blue ice and drifting snow beneath a pale winter sky.'),
  @(6, 'factory', 'Defective Processing Plant', '#e9ba42', '#7c939a', '#20272c', 'plate', 'square', 'stripes', 'Faulty production lines, hazard stripes and industrial steel.'),
  @(7, 'sky', 'Sky - Title TBD', '#a2e5f3', '#eab6dd', '#314866', 'pill', 'rounded', 'dots', 'Floating islands and wind-swept cloud bridges. Chapter title to be announced.'),
  @(8, 'magma', 'Magma - Title TBD', '#ffb34d', '#ee4b39', '#302028', 'slant', 'diamond', 'diagonal', 'Cracked basalt and molten rivers beneath a volcanic glow. Chapter title to be announced.'),
  @(9, 'optics', 'Optics - Title TBD', '#72f0e1', '#d57af0', '#181f3a', 'plate', 'diamond', 'grid', 'Prisms, split beams and geometric chambers of light. Chapter title to be announced.'),
  @(10, 'ocean', 'Ocean - Title TBD', '#5fdddf', '#4385c7', '#102e47', 'pill', 'drop', 'dots', 'Deep blue water, coral silhouettes and luminous currents. Chapter title to be announced.'),
  @(11, 'cavern', 'Cavern - Title TBD', '#a59be0', '#64c4b1', '#252238', 'plate', 'diamond', 'diagonal', 'Faceted crystals and narrow passages below the surface. Chapter title to be announced.'),
  @(12, 'galaxy', 'Galaxy - Title TBD', '#b5a4fa', '#ec91c1', '#1c203d', 'disc', 'circle', 'dots', 'Orbital paths, distant stars and violet nebulae. Chapter title to be announced.'),
  @(13, 'unknown', 'Chapter 13 - TBD', '#a9b7c9', '#647b98', '#222c40', 'pill', 'rounded', 'grid', 'Theme and chapter title to be announced.'),
  @(14, 'unknown', 'Chapter 14 - TBD', '#bac5be', '#7b958b', '#23322f', 'pill', 'rounded', 'grid', 'Theme and chapter title to be announced.'),
  @(15, 'cyberfunk', 'Cyberfunk - Title TBD', '#ff75c2', '#5ce8df', '#291d43', 'disc', 'square', 'grid', 'Neon equalizers, chrome circuits and a late-night dance floor. Chapter title to be announced.'),
  @(16, 'unknown', 'Chapter 16 - TBD', '#cfbfd9', '#93829e', '#302637', 'pill', 'rounded', 'grid', 'Theme and chapter title to be announced.')
)

# Silhouettes remain readable at world-tile size. Colors inherit the chapter palette.
$motifs = @{
  desert = '<circle cx="285" cy="116" r="58" fill="currentColor" opacity=".65"/><path d="M25 315 95 190 155 265 220 145 365 315Z" fill="currentColor" opacity=".3"/><path d="M140 300V165H260V300M167 300V195H233V300" fill="none" stroke="currentColor" stroke-width="18"/><path d="M120 155H280M125 316H275" stroke="currentColor" stroke-width="12"/>'
  wood = '<path d="M38 270 94 105 150 270M260 250 310 90 365 250" fill="currentColor" opacity=".25"/><g fill="none" stroke="currentColor"><circle cx="200" cy="213" r="98" stroke-width="15"/><circle cx="200" cy="213" r="70" stroke-width="3"/><circle cx="200" cy="213" r="48" stroke-width="5"/><circle cx="200" cy="213" r="22" stroke-width="3"/><path d="M100 335 300 110M125 355 325 130" stroke-width="13"/></g>'
  botany = '<g fill="none" stroke="currentColor" stroke-width="9"><path d="M200 340V210M200 295Q95 290 82 205Q178 210 200 295M200 270Q310 260 318 170Q225 183 200 270"/></g><path d="M200 82Q252 146 245 195Q239 239 200 244Q159 238 155 195Q148 146 200 82Z" fill="currentColor"/><path d="M180 155 190 175M220 155 210 175" stroke="#142c27" stroke-width="8"/><circle cx="92" cy="120" r="9" fill="currentColor"/><circle cx="310" cy="302" r="6" fill="currentColor"/>'
  frost = '<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M200 80V320M96 140 304 260M96 260 304 140" stroke-width="12"/><path d="M172 102 200 130 228 102M172 298 200 270 228 298M101 173 139 165 133 128M267 272 261 235 299 227M101 227 139 235 133 272M267 128 261 165 299 173" stroke-width="7"/><path d="M200 152 242 176V224L200 248 158 224V176Z" stroke-width="5"/></g>'
  factory = '<path d="M85 300V165L150 205V165L215 205V145H310V300Z" fill="currentColor" opacity=".7"/><path d="M249 145V85H278V145" fill="currentColor"/><g stroke="#20272c" stroke-width="13"><path d="M118 240H151M182 240H215M249 240H282"/></g><path d="M65 330H335" stroke="currentColor" stroke-width="18" stroke-dasharray="23 12"/>'
  sky = '<path d="M70 267 192 187 330 254 200 321Z" fill="currentColor" opacity=".55"/><path d="M70 267 200 321 190 365Z" fill="currentColor" opacity=".3"/><path d="M75 152Q62 112 104 107Q115 66 155 87Q192 75 202 113Q242 118 226 152Z" fill="currentColor"/><path d="M240 192Q236 168 264 161Q287 130 314 158Q349 156 352 192Z" fill="currentColor" opacity=".7"/>'
  magma = '<path d="M55 325 150 160 179 176 207 122 340 325Z" fill="currentColor" opacity=".35"/><path d="M179 176 207 122 229 174 212 211 240 248 213 290 240 344M150 160 160 216 128 252 150 292 128 344" fill="none" stroke="currentColor" stroke-width="13"/><path d="M170 102 151 67M233 85 252 48M290 139 325 118" stroke="currentColor" stroke-width="9"/>'
  optics = '<path d="M200 95 305 290H95Z" fill="currentColor" opacity=".12" stroke="currentColor" stroke-width="7"/><path d="M35 210H145" stroke="#ffffff" stroke-width="9"/><path d="M145 210 247 185 370 134" fill="none" stroke="#ff799c" stroke-width="7"/><path d="M145 210H262L375 210" fill="none" stroke="#98ecc6" stroke-width="7"/><path d="M145 210 277 238 370 295" fill="none" stroke="#a59bff" stroke-width="7"/>'
  ocean = '<g fill="none" stroke="currentColor"><path d="M30 158Q90 116 150 158T270 158T390 158M20 209Q80 167 140 209T260 209T380 209M25 260Q85 218 145 260T265 260T385 260" stroke-width="9"/><circle cx="290" cy="85" r="15" stroke-width="4"/><circle cx="110" cy="100" r="9" stroke-width="4"/><path d="M105 345V285M105 323 76 302M105 312 135 285M285 350V290M285 331 253 307M285 315 312 292" stroke-width="9"/></g>'
  cavern = '<path d="M30 60 100 190 143 100 178 143 211 60M220 340 281 245 320 340 370 245 395 340" fill="currentColor" opacity=".3"/><g stroke="currentColor" stroke-width="5"><path d="M200 95 252 166 228 298 173 314 147 172Z" fill="currentColor" opacity=".6"/><path d="M200 95 193 191 173 314M147 172 193 191 252 166" fill="none"/><path d="M95 213 130 247 138 313 85 293Z" fill="currentColor" opacity=".5"/></g>'
  galaxy = '<g fill="none" stroke="currentColor"><circle cx="200" cy="202" r="65" stroke-width="5"/><ellipse cx="200" cy="202" rx="160" ry="48" transform="rotate(-28 200 202)" stroke-width="12"/><ellipse cx="200" cy="202" rx="184" ry="103" transform="rotate(-28 200 202)" stroke-width="2" opacity=".4"/></g><path d="M105 77V117M85 97H125M310 291V327M292 309H328" stroke="currentColor" stroke-width="5"/><circle cx="291" cy="96" r="6" fill="currentColor"/>'
  cyberfunk = '<path d="M60 320V240M100 320V185M140 320V225M180 320V130M220 320V165M260 320V98M300 320V185M340 320V245" stroke="currentColor" stroke-width="19"/><path d="M40 340H360M85 368 145 340M315 368 255 340" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="105" cy="108" r="33" fill="none" stroke="currentColor" stroke-width="7"/>'
  unknown = '<rect x="105" y="110" width="190" height="190" rx="28" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="12 12"/><path d="M165 166Q169 137 200 139Q241 139 237 174Q235 191 211 201Q200 206 200 228" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><circle cx="200" cy="261" r="8" fill="currentColor"/>'
}

foreach ($chapter in $chapters) {
  $number, $concept, $name, $light, $accent, $dark, $badgeKind, $shape, $pattern, $description = $chapter
  $nn = '{0:D2}' -f [int]$number
  $id = if ($concept -eq 'unknown') { "chapter-$nn" } else { $concept }
  $folder = Join-Path $themeRoot "chapter-$nn-$concept"
  [IO.Directory]::CreateDirectory($folder) | Out-Null
  $motif = $motifs[$concept]
  $cover = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="$name">
  <defs><linearGradient id="bg" x2=".7" y2="1"><stop stop-color="$dark"/><stop offset="1" stop-color="$accent"/></linearGradient><radialGradient id="halo"><stop stop-color="$light" stop-opacity=".2"/><stop offset="1" stop-color="$light" stop-opacity="0"/></radialGradient></defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <circle cx="200" cy="200" r="190" fill="url(#halo)"/>
  <path d="M24 80V24H80M320 24H376V80M24 320V376H80M320 376H376V320" fill="none" stroke="$light" opacity=".35" stroke-width="2"/>
  <g color="$light">$motif</g>
  <text x="32" y="49" fill="$light" font-family="sans-serif" font-size="12" letter-spacing="4">CHAPTER $nn</text>
</svg>
"@
  [IO.File]::WriteAllText((Join-Path $folder 'cover.svg'), $cover)
  $button = @{ shape=$shape; fill=$dark; fill2=$accent; clearedFill=$accent; border=$light; borderWidth=2; font='title'; numberSize=30; numberColor=$light; pad=2; showStars=$true; showDifficulty=$true }
  $info = [ordered]@{
    format=1; id=$id; name=$name; description=$description; author='Avoid N Survive'; released='2026-11-17'; unlockStars=0
    colors=@($light,$accent); cover='cover.svg'
    style=@{
      cursorColor=$light
      badge=@{ kind=$badgeKind; primary=$dark; secondary=$accent; numberColor=$light; titleColor=$light; font='title'; pad=2; showTitle=$true; caption="CHAPTER $nn / $($concept.ToUpperInvariant())" }
      maze=@{
        wall=@{ fill=@{type='pattern';pattern=$pattern;color=$accent;background=$dark;size=16};edge=$light }
        path=@{ fill=@{type='gradient';style='linear';from=$dark;to=$accent;angle=90};edge=$accent }
      }
    }
    screens=@{select=@{
      background=@{color=$dark;color2=$dark}
      elements=@(
        @{id='art';kind='image';x=0;y=0;w=440;h=720;src='cover.svg';opacity=0.5},
        @{id='chapter';kind='text';x=52;y=54;w=330;h=32;text="CHAPTER $nn / $($concept.ToUpperInvariant())";font='main';size=19;color=$light;align='left'},
        @{id='title';kind='text';x=52;y=105;w=340;h=160;text='{theme}';font='title';size=42;color=$light;align='left'},
        @{id='description';kind='text';x=52;y=290;w=320;h=140;text='{description}';font='main';size=19;color=$light;align='left'},
        @{id='progress';kind='text';x=52;y=485;w=320;h=46;text='{cleared} / {total} CLEARED';font='main';size=21;color=$light;align='left'},
        @{id='grid';kind='levelGrid';x=470;y=140;w=750;h=420;cols=7;rows=3;gap=14;button=$button},
        @{id='back';kind='back';x=52;y=610;w=190;h=54;text='BACK';font='title';size=23;color=$light;fill=$dark;border=$accent;borderWidth=2;radius=10},
        @{id='footer';kind='text';x=470;y=600;w=750;h=38;text='SELECT A LEVEL';font='main';size=18;color=$light;opacity=0.6}
      )
    }}
  }
  # Keep separately authored soundtrack settings when regenerating the visual design.
  $infoPath = Join-Path $folder 'theme.json'
  if (Test-Path -LiteralPath $infoPath) {
    $previous = [IO.File]::ReadAllText($infoPath) | ConvertFrom-Json
    foreach ($field in @('music', 'credits')) {
      if ($previous.$field) { $info[$field] = $previous.$field }
    }
  }
  [IO.File]::WriteAllText($infoPath, ($info | ConvertTo-Json -Depth 20) + "`n")
}
