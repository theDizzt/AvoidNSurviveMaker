# Main menu music

The bundled default is `main-menu.flac`: **- Platform** by **Or4nges**.

- Source: https://www.newgrounds.com/audio/listen/458694
- Artist: https://or4nges.newgrounds.com/
- License: https://creativecommons.org/licenses/by-nc-sa/3.0/
- The artist's description also credits Midimachine's *No Homers Club* as inspiration:
  https://www.newgrounds.com/audio/listen/455170
- Source provided locally as `temp/workshop_map/458694_8_bit.mp3`.
- Changes: decoded to 16-bit stereo FLAC, trimmed to source seconds 0.0315646–124.854,
  with 2 ms fades at the two boundaries to reduce clicks. This adapted audio is distributed
  under the same CC BY-NC-SA 3.0 license; attribution, noncommercial and share-alike terms apply.

The source is designated a loop by its author. The trimmed track loops as a decoded Web Audio
buffer, without a media-element seek or an MP3 re-encoding delay. It is not faded out between
passes. The original MP3 is not modified.

To replace the bundled music, keep exactly one `main-menu.mp3` (or `.ogg`, `.wav`, `.m4a`,
`.aac`, `.flac`) here and update the attribution in the options screen and this file.

Players can choose a local override under Options → Main menu music. The override is stored
in this browser using IndexedDB; Reset music returns to the bundled default. Menu music plays
on the main menu, chapter list and settings. Theme selection/gameplay uses the theme's own
`music` asset, or silence when none is configured. The map editor (and its test play) plays the
menu music, unless the map uses a chapter preset whose theme has music; then that music plays. Playback starts after a user interaction,
loops, and follows master/music volume. Hidden tabs pause playback.
