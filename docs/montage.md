# Cutting a film on tracks

The atelier's timeline has two ways of showing a composition. A composition made of layers shows one row per layer, as before. A **sequence** shows lanes: its clips (videos, sounds, pictures) sit on tracks, one after another, the way a video editor lays them out. A sequence is still a composition: the engine reads it like any other, it can be nested, animated and exported, and its file format only gains a few optional fields ([document format](document.md), "Sequences").

Right click an empty place of the timeline and choose "Lay the layers out on tracks" to make a sequence of the open composition, or "Add a picture track" to start one. Nothing is moved in time or in the stack: the picture is drawn as before.

## The lanes

Each track has a header: its name (double click), the **magnet** (the track closes its gaps by itself), the eye (a hidden track is neither drawn nor heard), the sound (muted: drawn, silent), solo (the preview plays that track's sounds alone) and the **lock** (a locked track refuses every edit, and so does a clip linked to a clip of a locked track). The header's menu sets the lane height, adds a picture or a sound track, adds an adjustment clip, and removes an empty track.

A clip dropped on another lane changes track. On a magnetic track, a drag lets the clip fall among the others and the track closes up behind it; a trim ripples what follows.

## The keys

| Key | |
|---|---|
| Ctrl+B | cut at the playhead (the selected clips, or every unlocked clip under it) |
| Q, W | trim the start, the end of the selected clips to the playhead (ripple on a magnetic track) |
| Delete | delete; on a magnetic track, close the gap behind |
| Shift+Delete | delete and close the gap, whatever the track |
| Ctrl+C, Ctrl+V | copy clips, paste them at the playhead (inserted on a magnetic track, laid over elsewhere) |
| Ctrl+Alt+V | paste the look (transform, effects, masks, blend, speed) onto the selection |
| L, Ctrl+Shift+L | link, unlink the selected clips |
| , and . | insert, lay over the media chosen in the media panel at the playhead |
| I, O | mark the start, the end of what an export renders |
| Shift+Z | the whole timeline in view |

With the mouse: **Shift** on the edge of a clip rolls the cut between two shots; **Alt** and drag a clip slips what it shows in its file; **Ctrl+Alt** and drag slides it between its neighbours; **Alt** while dropping media does the other of insert and lay over.

## Media

Drag a medium from the media panel onto a lane. A video with a sound arrives as a picture and its own sound, linked, the picture muted. A composition dragged from the panel onto a lane is one clip, as long as it is (a composition never holds itself).

- **Bins and tags** sort the media; the search finds a name, a file, a bin, a tag (`#talk`) or a word said in a clip once it is transcribed.
- **The source monitor** (media menu, "Open in the source monitor") plays a medium alone; I and O set the part to keep, which can be inserted, laid over or saved as a **sub-clip**: a name for a range of a file that is already in the project (nothing is copied).
- **Media gone missing** are listed offline, the rest plays, an export names every missing file; "Find the files…" writes the files you pick where the media expect them.
- **Line clips up by their sound** (clip menu): two cameras, or a camera and a recorder, are compared by the loudness of their sound and moved to agree. **Cut between these cameras** does that, puts each camera on its own track and opens a panel (Alt+1…9) that cuts to a camera at the playhead, while the film plays or not; the cuts are plain clips.
- **Match the look of the first selected clip** puts colour wheels on the others, bringing their colours to the first one's; the wheels stay editable.

## Sound

The mixer (the tab beside Curves) has a strip per sound track and bus: the fader (dB), the pan, mute, solo and the bus it feeds. Arm **W** and move a fader while the film plays to write its moves as the automation of the track's volume. A bus holds no sound: its volume, pan and mute apply to the tracks that feed it. The master shows the loudness aimed at and measures the mix. The microphone button in the transport records a voice-over from the playhead (a count-in, then the film plays; Escape drops the take) and lays it on the sound track.

## Publishing

The export popover starts with where the film is going: a vertical short, a square, a landscape film, a 4K master or a GIF. What stands between the film and that place (length, proportions, size, frame rate, loudness) is listed, each with its fix; the proportions of a landscape film for a vertical format are fixed by the assistant (a 9:16 version). **I** and **O** mark the part to export. Several exports can wait in line, each on the film as it was when it was added, while you go on editing. The browser's file carries no chapters: markers of kind `chapter` are copied as a list for the description; the command line's render writes them into the file.

## The assistant

Every operation above is also a tool the assistant can run (`ripple_delete`, `insert_clip`, `overwrite_clip`, `ripple_trim`, `roll`, `slip`, `slide`, `detach_audio`, `link`, `sync_clips`, `add_adjustment`, `match_look`, `publish`), through the same functions as the gestures, so a cut made in words is the cut made by hand, and one undo takes it back.
