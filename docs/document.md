# The Tramme document (`tramme/1`)

A project is a JSON file `*.tramme.json`. It is the source of truth: the editor, the AI and the renderer read and change this file, nothing else. The JSON schema is in `schema/tramme-1.schema.json`.

## Structure

```jsonc
{
  "schema": "tramme/1",
  "meta": { "title": "Title", "description": "…" },
  "tokens": { "ink": { "type": "color", "value": "#1C1917" }, "swift": { "type": "ease", "value": [0.16, 1, 0.3, 1] } },
  "assets": { "photo": { "type": "image", "src": "img/photo.png", "box": [40, 225, 990, 960] } },
  "plugins": ["myNodes"],
  "root": "main",
  "compositions": {
    "main": {
      "name": "Film", "width": 1080, "height": 1920, "fps": 30, "duration": 12,
      "background": "@ink",
      "motionBlur": { "samples": 8, "shutter": 0.5 },
      "markers": [{ "id": "m1", "t": 3, "label": "Title", "kind": "scene" }],
      "effects": [{ "id": "grain", "type": "look.grain", "props": { "amount": 0.02 } }],
      "layers": { "title": { "type": "text", "props": { "text": "Hello" } } },
      "order": ["title"]
    }
  }
}
```

- Editable collections (`tokens`, `assets`, `compositions`, `layers`) are maps keyed by id (letters, digits, `_`, `-`). A patch path therefore stays valid when other items are added or removed.
- A video or sound asset may be a sub-clip: `of` names the media (another asset of the same kind, that is not a sub-clip itself) and `range` is `[in, out]` in seconds of its file. It is a name for a range, not a file: it is never loaded, and a layer made from it plays the media from `in`, as long as the range.
- An asset may be kept in a `bin` (a name) and carry `tags` (lower case, no spaces) to find it by in the media panel; the engine ignores both.
- An asset may keep `hash`, the hash of its file's content written by the editor at import: importing the same file again (from the assets panel, as an attachment of the assistant, among the sources of a new project) gives back the asset that has it, and nothing is written twice.
- An asset a model made (a cut-out's mask, a depth map, a transcript, a track, an analysis) keeps `madeBy`, the models and versions that made it (`["u2net-human-seg@e6d4c49…", "yolos-tiny@main"]`). Choosing another model in the settings never changes it; its tool, run again, writes it anew.
- Order lives in arrays: `order` (root stack) and `children` (groups), **from bottom to top**: the last id is drawn on top.
- Each layer appears exactly once in the tree.
- Time is in seconds (composition time), space in composition pixels, rotations in degrees (clockwise), scale as a factor (1 = 100%), opacity from 0 to 1.

## Layers

```jsonc
{
  "type": "shape.rect",          // node type from the registry
  "name": "Background",
  "in": 2, "out": 6,             // visible from in (included) to out (excluded); default: the whole composition
  "visible": false,              // hidden; can still be used as a clip
  "clip": "mask",                // id of a layer with an outline that clips this one (same parent)
  "blend": "multiply",           // normal multiply screen overlay darken lighten add
  "transform": { "anchor": [0, 0], "position": [540, 960], "scale": [1, 1], "rotation": 0, "opacity": 1 },
  "props": { "size": [1080, 1920], "fill": "@ink" },
  "children": []                 // groups only
}
```

Local matrix: `translate(position) · rotate(rotation) · scale(scale) · translate(-anchor)`. A group's children are drawn in the group's local space. Rectangles, ellipses and image frames are **centered on the layer's origin**; text has its origin on the baseline.

### Masks

A layer's `masks` cut what it draws, in order, before its effects: each is `{ id, enabled?, props }`, its props `path` (in the layer's own space, as a `shape.path` writes it, animatable), `mode` (`add`: shown inside; `subtract`: hidden inside; `intersect`: kept where the masks before it and this one meet), `feather` and `expansion` (px), `opacity` and `invert`.

```json
"masks": [{ "id": "window", "props": { "path": { "v": [[-300, -200], [300, -200], [300, 200], [-300, 200]], "closed": true }, "feather": 12 } }]
```

### Components

A composition that lists `params` is a component: each parameter has a `type` (a property type: `number`, `vec2`, `color`, `text`, `asset`…), the `targets` it lands on (addresses in the composition: `card.fill`, `title.transform.position`, `glow.effects.blur.radius`, `$comp.background`), and an optional `default`, `label`, `description` (`options` for an enum). A `comp` layer holding it is an instance: its `params` give a value per parameter (any form: fixed, keyframed, an expression, a link, read in the composition holding the instance), its `overrides` set any property of the component by its address, for this instance alone. A parameter the instance leaves out takes its default; without a default its targets keep their own values. Changing the component changes every instance, except what an instance sets.

```jsonc
"card": {
  "params": {
    "color": { "type": "color", "targets": ["plate.fill"], "default": "@paper" },
    "title": { "type": "text", "targets": ["label.text"] }
  }, …
},
// in another composition
"first": { "type": "comp", "props": { "comp": "card" }, "params": { "title": "Hello", "color": "@accent" }, "overrides": { "plate.radius": 32 } }
```

An instance's parameter reads as `first.params.title` (a link, an expression's `prop()`). A composition must not hold itself, through instances or not. Detaching an instance (`detachPlan` in `@tramme/core`) turns it into a group of plain layers drawing the same: the parameters and overrides written in, the keyframes moved to the holding composition's time. It is refused when the copy could not draw the same: a nested time that does not run one to one (a speed other than 1, a loop, a remap), an expression or a modifier reading the time while the copy is moved, an expression reading the component's own size or markers, a camera or finishing effects in the component.

### Distributions

A comp layer's `distribute` makes N instances of its component at once. `layout` places them in the layer's own space, centred on its origin: `grid` (`columns`, `spacing` [x, y]), `list` (`direction`, `spacing`), `circle` (`radius`, `start` and `sweep` in degrees, `rotate`), `path` (a `path` as a `shape.path` writes it, `rotate` along it) or `points` (the vertices of another layer's path, in the same parent). The count is `count`, else one per row of `rows` (a JSON asset holding an array), else one per point. `params` gives each parameter by a rule: a value, an expression (`index`, `count`, `row`, `random(index)`, `noise(index * 0.3)`, `t`…), or `{ "$palette": "order" | "random", "seed"?, "colors"? }` (the colours given, else the document's colour tokens). The comp layer's own `params` and `overrides` apply to every instance first. `time` plays each instance later by a time field over the instances (`mode`, `amount` and the rest as in `timeField`; `center` in the layer's space, its origin by default): a wave across a grid, a ripple from its centre, a liquid desynchronisation; an instance waiting holds the component's first pose, one past its end its last, or goes round with `loop`. Inside, each instance has its rank: `stagger`, `noise` and the expressions read the instance's `index` and `count`, and its modifiers' noise is its own.

```json
"cards": { "type": "comp", "props": { "comp": "card" }, "transform": { "position": [540, 960] },
  "distribute": { "count": 12, "layout": { "type": "grid", "columns": 3, "spacing": [320, 220] },
    "params": { "color": { "$palette": "order" }, "title": { "$expr": "'Card ' + (index + 1)" } } } }
```

### Styles and animations

`styles` at the document's top level are sets of properties defined once, by their name on a layer (`fill`, `radius`, `transform.opacity`). A layer applies them in order with `styles: [{ "style": "ink" }, { "style": "pop", "at": 2 }]`: each sets its properties over the layer's own, the later over the earlier. Keyframed, a style is an animation: written from 0, moved by `at`. `map` applies a style's property to another one of the layer (`{ "transform.scale": "size" }`).

```json
"styles": {
  "pop": { "props": { "transform.scale": { "$k": [{ "t": 0, "v": [0, 0], "ease": "@swift" }, { "t": 0.4, "v": [1, 1] }] } } },
  "ink": { "props": { "fill": "@ink", "radius": 8 } }
}
```

## Properties: four forms

| Form | Example | Meaning |
|---|---|---|
| static | `12`, `[540, 960]`, `"#1C1917"` | the JSON value itself |
| keyframes | `{ "$k": [{ "t": 0, "v": 0, "ease": "@swift" }, { "t": 1, "v": 100 }] }` | interpolation; `ease` applies to the segment starting at the keyframe |
| expression | `{ "$expr": "value + Math.sin(t * 2) * 10" }` | pure JavaScript, evaluated at each time |
| link | `{ "$link": "title.size" }` or `{ "$link": "@ink" }` | the value of another property or of a token |

- Curves (`ease`): `"linear"` (default), `"hold"` (step), a CSS Bézier `[x1, y1, x2, y2]` (x between 0 and 1, y free to overshoot), or a curve token `"@swift"`. Four Béziers cover most moves; define them once as tokens and reference them: out `[0.16, 1, 0.3, 1]` for entrances, in `[0.7, 0, 0.84, 0]` for exits, standard `[0.4, 0, 0.2, 1]` for moves within the scene, emphasized `[0.2, 0, 0, 1]` for the expressive ones.
- Keyframes are sorted by time. Outside the keyframe range, the value is that of the nearest keyframe.
- An expression can sit on top of keyframes: `{ "$k": [...], "$expr": "value * 2" }` (`value` is the interpolated value).
- Property address: `layerId.propName`, `layerId.transform.position`, `$comp.background`, `$comp.motionBlur.samples`, `$comp.effects.<effectId>.<prop>`.
- Keys starting with `$` are reserved.

### Colors and tokens

Wherever a color is expected (gradient stops included), `"@name"` refers to the color token `name`. Use tokens rather than hard-coded values: changing a token changes the whole film. A fill (`paint`) is a color, `null`, or a gradient in local coordinates:

```json
{ "type": "linear", "from": [-540, -960], "to": [-162, 960], "stops": [[0, "@goldA"], [1, "@goldB"]] }
{ "type": "radial", "center": [0, 0], "radius": 300, "stops": [[0, "#FFFFFF"], [1, "#00000000"]] }
```

### Expressions

A single expression (`value + 10`) or a body with `return`. Available names: `t` (= `time`), `frame`, `fps`, `value`, `comp` (`width`, `height`, `duration`, `fps`), `prop('layer.prop')`, `token('name')`, `marker('id|kind|label')` (`{ t, frame }`), `ease(spec, x)`, `clamp`, `lerp`, `prog(t, a, b)`, `smoothstep`, `linear(t, t0, t1, v0, v1)`, `random(seed)`, `noise(x, y, z)`, `add`, `sub`, `mul`, `Math` (without `Math.random`), `audio(source)`, `events(source)` and `track(layer, name?, at?)` (below), `index` and `count` (the layer's rank among its siblings, bottom first, and their number; inside an instance of a distribution, the instance's), `row` (inside an instance of a distribution over data, its row), and the modifiers below. An expression must stay a pure function of `t`: no state, no unseeded randomness, no access to the browser.

### Camera (2.5D)

A composition may have a `camera`: `{ "pan": [x, y], "zoom": 1, "perspective": 1000, "focus": 0, "blur": 0 }`, all animatable. Each root layer then sits at its `transform.depth` (px behind the screen, negative in front): it is scaled by `zoom · perspective / (perspective + depth)` around the centre of the frame, so far layers move less when the camera pans (parallax), and blurred by `blur · |depth − focus| / 1000` px. A far layer looks smaller: scale it up to keep its size. Children follow their parent. Without a camera, depth does nothing.

### Modifiers

An animated property (keyframes, expression or link) can get a stack of modifiers, applied in order: `"$mod": [{ "type": "wiggle", "freq": 2, "amp": 12 }]`. A modified fixed value is written `{ "$v": value, "$mod": [...] }`.

| Type | Parameters | Effect |
|---|---|---|
| `wiggle` | `freq` (Hz), `amp`, `seed`, `octaves` | adds smooth noise, different per component |
| `loop` | `mode`: `cycle`, `pingpong`, `offset`; `start`, `end` | repeats the keyframe animation beyond the last keyframe |
| `spring` | `freq` (Hz), `damping` (0 to 1) | each keyframe change becomes a spring's response (bounces when `damping` < 1) |
| `stagger` | `delay` (s), `from`: `first` or `last` | offsets the animation by the layer's rank among its siblings (the `rank` case of `timeField`) |
| `noise` | `amp`, `scale`, `seed` | fractal noise fixed in time (value texture) |
| `smooth` | `window` (s) | smooths the curve with a moving average |
| `react` | `source` (sound or video layer id, or asset), `signal` (`beat`, `bar`, `hit`, `rms`, `low`, `mid`, `high`), `amount`, `decay` (s) | adds `amount` times the music's signal: a pulse on each beat, bar or hit, or the loudness of a band |
| `near` | `source` (a layer, the pointer), `radius` (px), `amount` (in the property's unit), `axis` (`both`, `x`, `y`), `mode` (`lift`, `push`), `freq` (Hz), `damping` (0 to 1) | answers a moving layer: the value moves by `amount` as the pointer comes within `radius` (a smooth falloff), and springs back when it leaves. The layer and its pointer must sit in the same space (siblings, or a group at the origin); the layer's own rest position is the value the pointer moves |
| `timeField` | `mode` (`rank`, `angle`, `distance`, `noise`), `amount` (s), `from`, `angle` (deg), `center` (px) or `source` (a layer), `scale` (px), `speed`, `seed`, `loop` | reads the property at `t − amount · d`: `d` the rank (`amount` per element), the place along the direction `angle` across the frame, the distance to `center` or to `source` out to the farthest corner, or gradient noise over the position (`scale` 0: a fixed random delay per element; `speed` drifts the field). Before or after its keyframes the property holds its ends; `loop` repeats it instead. Put the same field on every animated property of an element |

A modifier's number parameter may be keyframed (`"amount": { "$k": [...] }`): it slides from one value to the next, so an animated seed or amount never jumps.

### Following the music

Once a sound has an analysis (the `beats` tool saves it as the asset `analysis-<sound>`), expressions read it with `audio(source)`: `source` is the sound or video layer (times follow its in point and `start`), or the asset id. `audio('music').pulse(0.2)` is 1 on each beat and fades in 0.2 s; also `.barPulse(decay)`, `.hit(decay)`, `.energy('rms' | 'low' | 'mid' | 'high')` (0..1), `.beat`, `.bar` (ranks), `.phase` (0..1 inside the beat), `.section`. Without the analysis, every value is 0. For example a logo that kicks on each beat: `"scale": { "$v": [1, 1], "$mod": [{ "type": "react", "source": "music", "signal": "beat", "amount": 0.06, "decay": 0.18 }] }`.

### Event lists

A story that keeps score (money in any currency, laughs, points, kilometres, a weight, a time) keeps its events in one JSON asset, an event list, that several layers read: change the list and everything that tells the story follows. The `events` tool writes it (`assets/events/<name>.json`, asset `events-<name>`):

```json
{
  "version": 1, "kind": "events",
  "totals": { "cash": { "label": "Cash", "start": 23.67, "format": "£0.00" }, "weight": { "start": 75, "format": "0.0 kg" } },
  "events": [
    { "id": "petrol", "t": 3.1, "label": "Petrol", "detail": "Full tank", "values": { "cash": -18 } },
    { "id": "laugh", "t": 4.5, "label": "Laugh", "values": { "laughs": 1 } },
    { "id": "weigh-in", "t": 9, "label": "Weigh-in", "set": { "weight": 73.5 } }
  ]
}
```

- `t` is in seconds, in the time of the composition that reads the list. `values` add up: a running total is its `start` (0 by default) plus every change so far. `set` gives a total a value, whatever it was (a weight, a temperature); the change is the difference. A total that `totals` does not declare starts at 0.
- `format` writes a total: `0` is a digit always written, `#` one written when needed, the last `.` or `,` before digits is the decimal mark (a single `,` before three digits groups thousands): `£0.00`, `00`, `#,##0 pts`, `0,00 €`, `1 250 000 FCFA` from `# ##0 FCFA`. `0 day|0 days` gives the first form for one. `0:00` and `0:00:00` write seconds as a duration (`2:46`, `1:02:46`). Without a format, as many decimals as the values have. A loss gets a minus sign: `−£18.00`. Dates are not totals: put them in a label or a detail.

Expressions read it with `events(source)`, the asset id or the list's name: `.total('cash')`, `.text('cash', digits)` (written with its format, at least `digits` digits before the decimal mark), `.previous('cash')` (before its latest change), `.change('cash')` (that change), `.gains('cash')` and `.losses('cash')` (what it gained and lost so far), `.since(key?)` (seconds since the latest event, `Infinity` before the first), `.pulse(decay, key?)` (1 at each event, fading), `.last(key?)` and `.next(key?)` (the event, or null), `.find(id)`, `.count`, `.list`, `.keys`, `.format(value, key, { signed, digits })`, `.changes(event, key?)` (what an event of the list changed: `"−£18.00  +1"`), `.after(event, key?)` (the totals it left: `"£5.67"`), `.label(key)`. With a key, only the events that change that total count. Without the list, every value is neutral (0, `Infinity`, `"0"`). For example a logo that kicks at each event: `"scale": { "$expr": "add(value, mul([1, 1], 0.08 * events('events-main').pulse(0.25)))" }`; a title that names the latest event, a place or a mood rather than a number: `"text": { "$expr": "events('events-main').last()?.label ?? ''" }`.

Three tools show a list, each with layers that read it as they render: `event-counter` (the running totals in a corner: `text.counter` layers whose `from`, `to`, `progress` and `direction` are `events()` expressions), `event-tags` (an `events.tag` layer: a tag at each event, above the counters) and `event-receipt` (an `events.receipt` layer: every event, line by line, then the totals).

### Sequences

A film put together from clips is a composition with `"kind": "sequence"` and a list of `tracks`, bottom to top. The engine reads it like any composition (it can be nested, animated, exported); the track fields only say how the timeline lays it out and how the edit operations (`packages/core/src/montage.ts`) keep it whole. Not to be confused with the object tracks below, which follow something filmed.

```jsonc
"main": {
  "kind": "sequence",
  "tracks": [{ "id": "V1", "kind": "video", "magnetic": true }, { "id": "A1", "kind": "audio", "muted": false }],
  "layers": {
    "shot1": { "type": "video", "track": "V1", "link": "k1", "in": 0, "out": 4, "props": { "video": "take1" } },
    "shot1-sound": { "type": "audio", "track": "A1", "link": "k1", "in": 0, "out": 4, "props": { "audio": "take1" } }
  },
  "order": ["shot1-sound", "shot1"]
}
```

- A track is `{ id, kind: "video" | "audio", name?, locked?, hidden?, muted?, magnetic?, height? }`. A locked track cannot be edited by the operations; a magnetic one closes its gaps by itself; a layer on a `hidden` track is neither drawn nor heard, on a `muted` track it is drawn but silent (the exported film follows both). Soloing a track is a view of the editor's preview only, it is not written in the document.
- The mixer of a sound track: `volume` (dB, added to the gain of each sound on it; keyframed, its keys are the fader's automation), `pan` (-1 left to 1 right) and `to`, the bus it feeds. A bus is a sound track with `bus: true` that holds no sound: its `volume`, `pan` and `muted` apply to the tracks that feed it. The preview and the export read them through the same `audioClips`, so they sound alike.
- A layer's `track` puts it on a track of its composition (an unknown track is an error). Clips of one track follow one another; where a transition makes two overlap, the cut is the middle of the overlap.
- Clips sharing a `link` move, split and are deleted together (a video and its sound detached onto an audio layer). A link joining a single clip is noted by the `sequence` check.
- The draw order of `order` follows the tracks (a higher track above a lower one, a later clip above an earlier one); layers with no track keep their place.
- An audio layer may point at a video asset: it plays that file's sound, which is how a video's sound is detached.

### Tracks

Where something filmed is over time. The `track` tool follows an object through a video once, framed by a rectangle drawn over it at the current time, a region of the picture, or its name for what the detector knows (person, car, dog, bicycle…), and saves a JSON asset `track-<video asset>-<name>` (`assets/tracks/…`):

```json
{ "version": 1, "kind": "track", "source": "clip", "name": "car", "width": 1920, "height": 1080,
  "frames": [{ "t": 3.2, "box": [0.479, 0.393, 0.068, 0.245] }, { "t": 3.3, "box": null }] }
```

Times are those of the file and boxes `[x, y, width, height]` fractions of its picture, `null` where the object was lost; a cut ends the track. Read through a video layer, a track follows that layer: moved, scaled or cut otherwise, the object stays under its callout. Expressions read it with `track(layer, name?, at?)`, the video layer and the track's name (its first track without one), at the current time or at composition time `at`: `.found` (0 to 1: 0 when lost, out of the track or out of the layer's frame), `.box` `[x, y, width, height]`, `.center` and `.size`, in the space the video layer sits in (the composition for a layer at the root). For example a dot that rides on the car: `"position": { "$expr": "track('video', 'car').center" }`. The `callout` tool adds a `callout` layer that reads the track: brackets around the object, a label beside them.

## Built-in nodes

Each layer type declares its property schema; the inspector and the validator use it. Full list with defaults: the assistant's `list_nodes` tool, or `tramme nodes`.

| Type | Main properties |
|---|---|
| `shape.rect` | `size`, `radius`, `fill`, `stroke`, `strokeWidth` |
| `shape.ellipse` | `size`, `fill`, `stroke`, `strokeWidth` |
| `shape.path` | `path` `{ v, i?, o?, closed? }` (vertices, relative tangents), `fill`, `stroke`, `strokeWidth`, `lineCap`, `lineJoin` |
| `image` | `image` (asset), `size` (frame), `fit` (`cover`, `contain`, `fill`, `none`), `focus`, `zoom`, `offset`, `crop`, `box` |
| `sequence` | `frames` (list of image assets: the drawings in order), `hold` (frames per drawing, 2 = "on twos"), `sheet` (exposure sheet, e.g. `"1-4/2, 5/6, 4-1/2, x/3"`: drawings 1 to 4 held 2 frames, 5 held 6, then 4 to 1, then 3 blank frames; empty = every drawing held `hold`), `loop` (`loop`, `once`, `pingpong`), `offset` (frames of offset), `drawing` (0, or a forced drawing number: animate it with `hold` keyframes for a mouth), `size`, `fit`: frame by frame drawn animation, counted from the layer's in point |
| `text` | `text`, `font` (asset), `size`, `weight` (animatable), `italic`, `tracking` (em), `color`, `align`, `lineHeight`, `baseline` |
| `text.counter` | `from`, `to`, `progress` (0 to 1), `turns`, `direction` (`up`, or `down` to roll back for a value that goes down) + typography: a rolling counter |
| `events.tag` | `events` (event list asset), `key` (only the events that change this total), `show` (`change`, `total`: the total the event leaves, `label`), `hold` (s), `animation` (`pop`, `snap`, `rise`, `fade`), `uppercase`, `fill`, `padding`, `radius`, `gap` + typography: a tag at each event of the list, with what it changes |
| `callout` | `source` (the video layer), `track` (asset), `label`, `detail`, `side` (`auto`, `right`, `left`, `above`, `below`), `line`, `brackets` (`corners`, `box`, `none`), `padding`, `smooth` (s), `uppercase`, `fill`, `stroke`, `strokeWidth` + typography: brackets and a label that follow a tracked object, fading where it is lost; drawn in the space its video layer sits in (keep it beside the video, its transform at rest) |
| `events.receipt` | `events`, `title`, `subtitle`, `column` (`auto`, `detail`, `change`, `total`, `none`), `numbered`, `totals` (`"Spent: -cash; Change: cash"`: `-key` adds up the decreases, `+key` the increases), `interval` (s between lines), `typing`, `uppercase`, `lineHeight`, `paper`, `rule`, `highlight` (the last total), `width` (0: as wide as needed), `padding` + typography: every event on a receipt, typed line by line from the in point, then the totals; its origin is the middle, left or right of its top edge (`align`) |
| `group` | container: `children` |
| `comp` | `comp` (id of another composition), `time` (local time, animatable), `size`: nested composition |
| `particles` | deterministic emitter: `rate`, `life`, `speed`, `spread`, `gravity`, `size`, `color`, `seed` |
| `shader` | `shader` (fragment GLSL), `size`, `params`: an image made by a shader |
| `model.3d` | `source` (.glb asset), `height` (px), `spin` (deg/s), `yaw`, `pitch`, `explode` (animatable), `light` (`studio`, `sun`, `flat`), `env` (an environment image that lights it by reflection instead): a glTF 2.0 model drawn in 3D on its own WebGL2 service, its parts rigidly animated, framed square by `height` (the `model` tool places it) |
| `solid.3d` | `shape` (`box`, `slab`, `sphere`, `torus`, `capsule`, `cylinder`), `size` ([w, h, d] px), `radius` (rounding), `material` (`matte`, `glossy`, `glass`, `metal`), `color`, `roughness`, `env` (an equirectangular image asset; empty: a studio gradient between `envTop` and `envBottom`), `yaw`, `pitch`, `spin`, `height` (px): a simple solid shaded by GGX specular with Fresnel and the environment, glass refracting it, on the same WebGL2 service as `model.3d` |
| `lipsync` (tool) | `sequence` (the drawn character), `transcript`, `mouths` (json: which drawing shows each of the nine shapes — closed, M/B/P, F/V, A/I, E, O, U/W/Q, L, other): writes keys on the sequence's `drawing` so the mouth speaks with the voice |
| `follow` | `target` (a layer), `frequency` (Hz), `damping`, `size`, `color`, `trail` (frames): a dot following another layer on a spring, drawn in composition space |
| `rope` | `target` (a layer, the far end), `segments`, `length` (0: as it starts), `gravity`, `wind`, `damping`, `thickness`, `color`: a Verlet rope tied to the layer origin, swinging (drawn in composition space, keep its transform at rest) |
| `cloth` | `columns`, `rows`, `width`, `height`, `gravity`, `wind`, `sway`, `stiffness`, `color`, `wireframe`: a cloth pinned along its top edge, centred on the origin, that falls and catches a breathing wind |
| `flock` | `count`, `speed`, `cohesion`, `separation`, `alignment`, `margin`, `size`, `color`, `seed`: boids that steer together across the whole frame, deterministic on the seed (drawn in composition space) |
| `time.shift` | `comp` (a composition), `depth` (s), `slices`, `map` (`left`, `right`, `top`, `bottom`, `centre`, `edges`, `noise`), `scale`, `smooth`: the composition read later in some places than in others, `t + d(uv)` (slit-scan, a time ripple, a liquid time). It keeps a ring of the composition's past frames as a 3D texture, reduced in size to stay within 192 MB, and stays a pure function of time: each slice is the composition at a time fixed by the frame number |
| `code` | `module` (JS asset), `entry`, `params`: free drawing by existing code |
| `audio` | `audio` (asset), `start`, `gain` (dB, animatable), `fadeIn`, `fadeOut` (s), `lowCut` (Hz, animatable), `highCut` (Hz, 0 for none), `eqLow`/`eqMid`/`eqHigh` (dB, the equaliser: a shelf at 120 Hz, a bell at `eqMidFreq` Hz, a shelf at 8 kHz), `compress` (0 to 1, the loud moments brought down), `reverb` (0 to 1), `rate` (speed and pitch, 1 as recorded), `role` (`effect`, `music`, `voice`, `ambience`), `weight` (`support`, `hero`), `visual` (what it underlines: `cut`, `move`, `land`, `appear`): a sound placed at the layer's in point |

The sound of a layer (an `audio` layer, or a `video` layer not `muted`) has the same properties but `rate`, `role`, `weight` and `visual`. `gain` moves (keyframes make fades and ducking: lower under a voice, back between sentences), and so does `lowCut` (a build: the music thinned out before a hit). A layer plays its file from `start` between its in and out points, inside those of its groups, the file going by `rate` seconds a second; filters, the equaliser, the compressor, gain and fades apply in that order, the reverb beside them. `role` puts it on a bus: effects share the composition's room, music and ambience are the bed; unsaid, a video's sound is a voice, a sound named for music, an ambience or a voice is one, and any other an effect. `weight` and `visual` are read by the sound checks (a hero stands out more; an effect underlining a `move` should sit on one).

A composition's `sound` finishes its mix: `loudness` (LUFS, -14 by default: the master is brought to it, its true peak held under -1 dBTP; `null` leaves the mix as it is) and `room` (0 to 1, 0.15 by default: the share of one short room the effects have in common, so recordings from different places sound like one). The preview, the browser exports and the command line mix with one mixer (`@tramme/render`, `audio.ts`), so a sound is heard the same everywhere. Sounds are files: the editor's sound tools (library, sounds written as code, sounds made by a provider) save what they make under `assets/sounds/`, with what made it beside it (`<name>.sound.json`).

Composition finishing effects (`effects`): `look.vignette` (`amount`), `look.grain` (`amount`, `seed`), `look.bloom` (`amount`, `threshold`), `look.exposure` (`value`), `look.chromatic` (`amount` px), `look.grade` (`lift`, `gain`, `saturation`, `temperature`). Layer effects (`layer.effects`): `fx.blur` (`radius`), `fx.shadow` (`color`, `blur`, `offset`), `fx.glow` (`color`, `radius`, `strength`), `fx.color` (`brightness`, `contrast`, `saturation`, `hue`), `fx.tint` (`color`, `amount`), `fx.matte` (`source`: a layer, `mode`: `alpha`, `alpha-inverted`, `luma`, `luma-inverted`), `fx.displace` (`source`: a layer whose red and green push x and y, `amount` px), `fx.parallax` (`source`: a grey depth layer, bright where near; `plane`, `range` px, `amount`, and `perspective`, `zoom`, `at` to link to the composition camera and the layer's own depth), `fx.depthBlur` (`source`: a grey depth layer, `amount` px, `focus` 0..1).

A track matte: the layer shows only where `source` is. The matte layer is usually hidden (`visible: false`): it is still drawn for the effect, at the same instant, with its own animation. For example footage seen through a big title: the title hidden, the video with `{ "id": "m", "type": "fx.matte", "props": { "source": "title", "mode": "alpha" } }`.

Text behind a person works the other way round: the `cutout` tool saves the person's matte as a mask video (white where they are, timed like the file, under `assets/cutout/`), then adds two layers right above the video: the mask, hidden, and the same footage through it (`fx.matte` in `luma` mode). Both follow the video's frame and transform through links. Whatever sits between the video and these two in the stack passes behind the person. On a still picture, the `remove-bg` tool runs the same matte once and writes it as the picture's alpha: a PNG with transparency under `assets/cutout/`, added as an image asset and placed as its own layer — titles under it pass behind the subject.

Depth works the same way: the `depth` tool reads the depth of a photo or a video (Depth Anything v2, at authoring time) and saves it as a grey file (bright where near) under `assets/depth/`, timed like the file for footage, a PNG for a photo; a hidden layer plays it and `fx.parallax` on the source moves its pixels the way the composition camera would place them at that depth (its `perspective`, `zoom` and `at` linked to the camera and the layer's own `transform.depth`). Nothing moves until the composition has a `camera`. The `photo-2.5d` tool does the whole pass on a still photo: depth, camera (a slow drift) and a scale up past the relief's widest stretch.

## Node plugins

A plugin is a JavaScript module (asset `type: "module"`, listed in `plugins`) that exports `nodes`, `effects`, `modifiers`, `tools`, `prompts`, `checks` and/or `kits` (and, if it wants, `tours`: guided tours of its nodes in the editor, see [tours.md](tours.md)):

```js
export const nodes = [{
  type: 'demo.star', title: 'Star', category: 'Shapes',
  props: {
    points: { type: 'number', default: 5, min: 3, step: 1, label: 'Points' },
    radius: { type: 'number', default: 200, unit: 'px', label: 'Radius' },
    fill: { type: 'paint', default: '#FFFFFF', label: 'Fill' },
  },
  // local outline: makes the layer selectable and usable as a clip
  path(p) { const s = new Path2D(); /* ... */ return s; },
  bounds(p) { return { x: -p.radius, y: -p.radius, w: 2 * p.radius, h: 2 * p.radius }; },
  render: {
    canvas2d(ctx, p, host) {
      // host.t (time), host.frame, host.width, host.height, host.asset(id), host.assetInfo(id)
      ctx.fillStyle = p.fill;
      ctx.fill(this.path(p));
    },
  },
}];
```

Property types: `number`, `vec2`, `bool`, `color`, `paint`, `enum` (`options`), `string`, `text`, `ease`, `path`, `asset` (`assetType`), `layer` (another layer of the composition, drawn alone for an effect: mattes, maps), `json`. Options: `default`, `label`, `group`, `min`, `max`, `step`, `unit` (`px`, `deg`, `%`, `em`, `s`, `x`, `dB`), `animatable: false`, `nullable`. Rendering receives the properties already evaluated at time `host.t`, in the layer's local space; it must stay a pure function of these values and of time.

A node may also simulate: `simulate: { init(props, host), step(state, props, dt, host) }` carries a state from frame to frame (springs, ropes, flocks, trails). The engine steps it in order from the layer's in point at the composition's frame rate and keeps checkpoints, so any frame renders in any order and always gives the same picture; `step` returns a new state and never changes the one it is given. Rendering reads it with `host.state()`. `host.layer(id)` gives another layer's evaluated props and transform at the same instant (connectors, followers). The built-in `follow` node is an example: a dot following another layer on a spring.

A plugin should say who it is: `export const meta = { name, version, description, api: 1 }`. `api` is the plugin API it was written for; a Tramme with an older API refuses the plugin with a message rather than failing halfway. In TypeScript or with JSDoc, `@tramme/plugin` gives every type and `definePlugin()` for autocompletion.

A plugin can be installed on the user's device (Settings, Plugins: a `.js` module, or a `.trammeplugin` package, a zip of `plugin.js` and its own files such as fonts, LUTs and pictures), or kept there from a project with `library-add`. It is then offered in every project. Its tools, checks, workflows, kits and presets run in each project's sandbox. Its nodes, effects and modifiers are copied into the project's `plugins/` (with its own files) when a layer first uses one, so the project and its archive stay self-contained. `library-use` copies one by hand. An installed plugin says more about itself in `meta`: a stable `id` (`author/name`), a `version` (semver), a `licence`, an `author`, a `homepage`, and its `permissions`. Without them, an id is made from its name and its version is `0.0.0`.

```js
export const meta = {
  id: 'me/weather', name: 'Weather', version: '1.2.0', api: 1, licence: 'MIT',
  // what it may reach at authoring time; nothing when it declares nothing
  permissions: {
    network: ['https://api.weather.example'], // origins its tools may request, with ctx.fetch
    providers: ['generate'],                    // provider routes (/api/generate/…) called with the user's keys, which it never sees
    files: ['data/weather'],                    // project paths it may write beyond assets/
  },
};
```

The user is asked before a plugin is installed, and again when an update asks for more. An installed plugin's code never runs on the page: a project that holds a copy of one draws through the sandbox. A plugin whose tools or checks fail three times in a row is stopped until the editor opens again.

A node may declare `handles(props)`: points the viewport lets the user drag, in local space, each editing one property (`{ prop, at, kind: 'point' }` sets a vec2 to the point; `{ prop, at, kind: 'distance', from }` sets a number to the distance from `from`). Vector exports cannot run code: `export: { svg(props), lottie(props) }` gives SVG markup in local space and static Lottie shape items; without them the layer is left out with a warning.

A plugin may also export `presets`, ready-made layers offered in the add menu: `{ name, title, category, layer }` where `layer` is an ordinary layer (type, props, transform, effects), centred when it has no position. A preset may instead be an effect stack: `{ name, title, category, effects: [{ type, props }] }` — applying it pushes those effects onto every selected layer at once (ids made at apply time).

Nodes, effects, modifiers and tools may carry notes for the assistant, returned by `list_nodes`: `ai: { when, avoid, example }` (when to use it, what looks bad, an example of props or input).

### Tools

A plugin may also export `tools`: actions the assistant runs with `use_tool`, at authoring time (never during a render). A tool may analyse the media, compute data and lay out whole dressings. It saves what it computes as files under `assets/`, and changes the document only by returning operations, which join the assistant's proposal (validated, previewed, undoable).

```js
export const tools = [{
  name: 'demo.stars', title: 'Star field', description: 'scatters stars over the composition',
  input: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['count'] },
  ai: { when: 'a night sky or a festive background', avoid: 'more than 60 stars on a small format' },
  async run({ count }, ctx) {
    // ctx, all of it:
    //   doc: the document with the pending proposal applied (read only); compId: the composition the user is on;
    //   time: the editor's current time (s); selection: ids of the selected layers; registry: the document's vocabulary
    //   assetUrl(id): absolute URL of an asset's file; fileUrl(path): the same for any project file
    //   readText(path): a text file of the project, or null; files(): every file of the project (path, size)
    //   writeFile(path, data): under assets/ (computed data), or a plugin under plugins/ (.js, .mjs); returns the path
    //   renderStill(t, compId?): a JPEG data URL of a frame, pending proposal included
    //   transcript(assetId, { ask }?): the transcript of a sound or video asset (the user is asked to make it when missing)
    //   signal: aborted when the user stops the turn; progress(done, total, step?): how far a long tool is
    //   packFile(path): a data file beside a shipped pack (plugins/<pack>/), for the packs only
    //   fetch(url, init): an installed plugin's declared requests (meta.permissions), a Response
    const ops = [/* JSON Patch operations on ctx.doc */];
    return { text: `${count} stars`, ops, label: 'Star field' };
  },
}];
```

Effects can be written in GLSL: `gl: { code }` defines `vec4 effect(vec2 uv)`, reading `uImage` (premultiplied), `uRes` (pixels), `uScale` (pixels per composition pixel), `uTime`, and `u_<prop>` for each property (`float` for number, bool and enum (its rank), `vec2`, `vec4` for a colour, `sampler2D` for a `layer` prop). On a layer (`stage: 'layer'`) it runs on the layer drawn alone; as a finishing effect (`stage: 'finish'`), on the composed frame in linear light, before the glow and the grain.

```js
export const effects = [{
  type: 'demo.scanlines', title: 'Scanlines', category: 'Finishing', stage: 'finish',
  props: { amount: { type: 'number', default: 0.3, min: 0, max: 1 } },
  gl: { code: `vec4 effect(vec2 uv) { vec4 c = texture(uImage, uv); return c * (1.0 - u_amount * step(0.5, fract(uv.y * uRes.y / (3.0 * uScale)))); }` },
}];
```

In the editor's preview, a node or effect that fails is drawn as a red frame and named in the error bar; the rest of the frame renders. Exports and stills keep failing, so a broken film is never delivered.

`input` is a JSON Schema of an object; the input is checked against it before `run` (required keys, types, enums, bounds). `run` returns a string, or `{ text, images: [{ url, caption }], ops, label, reload }`: `images` are data URLs shown to the assistant and the user, `reload` lists assets whose files the tool rewrote.

Tools also appear in the chat's `/` menu, with a form generated from `input` (`title` as the label; `format: 'asset'` with `assetType` picks an asset, `format: 'layer'` a layer). Once the required fields are filled, the tool runs at once without a model; words written after the command send it to the assistant instead.

In the editor, a project plugin's authoring code runs in a sandbox of its own: one worker per project, with no page rights: no DOM, no `window`, Canvas2D or WebGL2 on an `OffscreenCanvas` for drawing, and a network that reaches the project's own origin only, plus what `ctx.fetch` allows of the origins and provider routes the plugin declared in `meta.permissions` (a plugin that declares none has no `ctx.fetch`). The tools and checks cross a message bridge for what they need — the document, the project's files, stills, transcripts — and the nodes are drawn there too: each frame the engine sends a layer's evaluated props, the frame's numbers and the other layers' data, and one picture comes back, drawn over the layer's bounds, with its outline as SVG path data and its viewport handles as plain data (a first pass defers, so exports and stills wait for the exact picture while the preview keeps the last one). A node's vector export (`svg`, `lottie`) is computed in the sandbox and primed before a conversion reads it. The assistant's surface does not change: `use_tool` and `list_nodes` speak in names and schemas as before. What still runs on the page, said plainly: the module's load, the modifiers, the Canvas2D effects, and the stepping of simulations — the tail of the isolation plan ([plugin-isolation.md](plugin-isolation.md)). The command line keeps its own rule: it loads plugins in Node, with a local tool's rights.

A plugin may also export `checks`: quality checks run by the `check` tool (assistant and `/check`) next to the built-in ones (text size, reading time, safe zone, overlapping text, text crossing an element, text over a person or on a busy area, low contrast behind text, crowded entrances, still stretches). A check reads the composition sampled four times a second, each layer placed in composition space, and returns issues:

```js
export const checks = [{
  name: 'brand.logo', description: 'the logo stays on screen',
  run({ samples, comp }) {
    const missing = samples.filter((s) => !s.layers.some((p) => p.id === 'logo' && p.opacity > 0.5));
    return missing.length ? [{ check: 'brand.logo', severity: 'warning', t: missing[0].t, message: `the logo is missing at ${missing[0].t} s` }] : [];
  },
}];
```

Each sample is `{ t, layers }`; a placed layer has `id`, `layer`, `node`, `props`, `opacity` (with its parents'), `box` (composition pixels) and, for text, `text` and `textSize` (the height of the type on screen).

A plugin may also export `kits`: style kits applied by the `kit` tool, as design tokens. The recipes (`kinetic-title`, `bar-chart`, `stat`, `transition`, `quote`, `logo-reveal`, `list`, `timeline`, `split-screen`, `map-journey`) and the dressings read these token names: `plate`, `ink`, `accent`, `accent2` (colours), `enter`, `exit` (curves), `pace` (seconds of an entrance), `stagger` (seconds between siblings). A kit may also name a `font` (`family`, `url` of a woff2, optional `weight` range): applying it fetches the file once and keeps it in the project as a font asset, so the film holds its voice offline too.

```js
export const kits = [{
  name: 'brand', title: 'Our brand', description: 'navy and coral, brisk',
  tokens: { plate: { type: 'color', value: '#0B1B3F' }, ink: { type: 'color', value: '#FFFFFF' }, accent: { type: 'color', value: '#FF6F59' },
    enter: { type: 'ease', value: [0.16, 1, 0.3, 1] }, pace: { type: 'number', value: 0.5 }, stagger: { type: 'number', value: 0.05 } },
}];
```

A plugin may also export `prompts`: workflows the user picks in the `/` menu, whose instructions guide the assistant for one kind of result. The editor's own ones cover the usual passes (a film from a brief, the sources read, a talking video dressed, a review, the motion polished, a sound design, shorts, a transcript, the silences cut, the edit on the beats, a still saved).

```js
export const prompts = [{
  name: 'night', title: 'Night sky', description: 'a whole night scene',
  prompt: 'Build a night sky: a gradient background, a star field (demo.stars), a moon that rises slowly. Check the result at 0 s and at the end.',
}];
```

## Typefaces

The editor ships no typeface. Two tools of its vocabulary (the assistant runs them with `use_tool`, you from the `/` menu) bring open ones into a project:

- `typefaces` looks for families by character ("condensed grotesque, heavy, for titles") in a catalogue of about 2,000 open families (Fontsource, under the OFL, Apache, MIT, CC0, Unlicense or UFL licences). It lists them with their weights, axes, scripts, licence and the families they pair with, and draws a specimen sheet in their own letters with the same text path as the render. Given the `text`, it keeps to the families whose letters cover it (accents, Cyrillic, Greek, Arabic, Hebrew, Japanese…).
- `typeface-use` fetches the chosen family's files at a pinned version of Fontsource (5.3.0, from jsDelivr), writes them under `assets/fonts/` with a record `assets/fonts/<family>.json` (family, licence, source, version, files, roles) and adds `font` assets. A variable family comes as one file for its whole weight range, a static one as one file per weight. The asset id is `font-<family>`, with the script, the weight (a static one other than 400) and `-italic` added when they differ. Role `display` names the asset "Family (display)" and `text` "Family (text)": the recipes write headlines in the display face and everything else in the text face, and a film with a single font uses it for both. Nothing is written unless every file was downloaded.

The catalogue is the static file `apps/editor/data/typefaces.json`, generated by `npm run typefaces:catalogue` from the Fontsource list, the axes of its variable families, the tags their data gives and the character written by hand in `scripts/typefaces/character.json`. Run it again to refresh the list or after editing that file; it needs the network and writes nothing if anything fails.

## Film plan and style frames

Before building a film or dressing a video, the assistant writes a plan and has the look drawn. Both are tools of the vocabulary (`use_tool` for the assistant, the `/` menu for you); the document changes only through the operations they return.

- `film-plan` writes `assets/film-plan.json` (also a `json` asset, `film-plan`). Its fields: `idea` (the story in a few sentences); `kinds` (2 to 5 of `interface`, `type`, `object`, `data`, `diagram`, `photo`, `3d`, `character`, `map`: kinds of picture, never layouts); `scenes` (`id` made from the name, `name`, `kind`, `idea`, and optionally `hero`, `comp`, `seconds`); `directions` (one to three, each with `name`, `type`, `palette`, `light`, `materials`, `framing`, written precisely); `example` (a kind and what it stands for, when you gave an example to match: its kind takes a third of the scenes at most). The tool puts what is wrong with the variety under `To fix:` and still writes the plan: no kind twice in a row, at least three kinds in a film of four scenes or more, none on more than half the scenes. A call again keeps the `frames` and the `target` set by `style-frames`.
- `style-frames` has an image model draw a finished frame of the film for each direction (up to the **Style frames** setting: Off, 2 or 3, 2 by default; each frame is a paid generation and counts against the turn's allowance), for the hero scene or the scene it is given. With one direction, the setting is the number of takes of it. `over: "frame"` draws over a still of the video, which OpenAI or Gemini restyle: the case of dressing a video. When you are there you pick the frame; when the assistant is alone the frames are held for the session and it keeps the strongest with `keep: "takes-…:<n>"`. A kept frame is written to `assets/frames/<scene>-<direction>.<ext>` with a record beside it (`.json`: prompt, provider, model, direction, scene). It is the film's **target**: the plan's `target` and `frames` name it, its direction comes first, and its palette becomes the colour tokens `picture1…`, `plate`, `ink` and `accent` (the ink always reads on the plate). A frame is never an asset of the document and never a layer: the film is built in layers to match it, the words read in it are retyped as text layers, its lettering is matched with `typefaces` (`compare` takes the frame, which fills the first cell of the sheet), and its plates and objects are made again without words with `generate-image` (`reference: "assets/frames/…"`).
- The `check` tool adds a line when consecutive scenes are built in one form (read from what each scene's composition is made of: `ui.*` layers, charts, text set large, pictures, solids, maps) and when a scene is built in another kind than the plan gave it. The form is a heuristic: it points, it does not judge.
- The assistant reads the plan (the idea, the kinds, one line per scene, the kept direction and the target) beside the brief in its instructions. The Studio's **Direction** panel shows the target, the idea and each scene with its kind, and a button to ask for other frames.

## Surfaces

`surface` lays a texture or a light drawn by the engine: a `shader` layer covering the composition, centred, with the preset's blend, free and the same on every render (each preset is a pure function of the layer's time, its size and its settings: no clock, no random state, nothing assumes a format). Nine presets: `grain` (a film grain redrawn 24 times a second, over), `paper` (fibres and tooth, under), `halftone` (a dot screen at 45 degrees, under, `p3` is the cell in px), `gradient` (soft blobs drifting between the two colours, under), `glow` (soft lights in the second colour, over, additive), `ribbons` (thin bands of light bent by sine fields, over), `grid` (a perspective floor fading to the horizon, under), `bokeh` (out-of-focus discs drifting up, over) and `caustics` (the light of water, under). The colours are the tokens `plate` and `accent` when the project has them (`@plate`, `@accent`), else the ones given (`colors`), else the preset's own; `amount` is `p1` and `speed` is `p2`. A surface under the content goes first in the order, one over it last. `at` and `duration` limit it to a span.

## Stock

`stock` searches the free libraries and keeps the chosen file under `assets/stock/` with a record `assets/stock/<name>.json` (`source`, `id`, `kind`, `title`, `author`, `license`, `landing`, `url`). Kinds and libraries, the best first: `texture` (Poly Haven, then ambientCG: the colour map), `hdri` (Poly Haven: the tonemapped picture, kept as an image asset that is not placed, its record marked `env`), `model` (Poly Haven: the glTF and its buffers packed into one `.glb`, textures left out, kept as a `model` asset and a `model.3d` layer), `photo` (Pexels, then Openverse) and `clip` (Pexels). Pexels needs its key, connected in the settings and held by the server; ambientCG is asked through the server too (it sends no CORS headers); the others are asked from the editor. Each search gives every library 8 seconds, shows at most 8 results on a contact sheet, and says which library did not answer. Only what may be used, shown and changed is shown: CC0, public domain, CC BY (the credit is kept) and the Pexels licence; never share-alike, no-derivatives or non-commercial. Keeping the same result twice adds nothing: the record's `source` and `id` decide. The `real` kind (a real brand's logo, a person, a product, searched on Wikimedia Commons) asks you first; in a turn left alone nothing is fetched, and the end of the turn lists what was wanted. The `credits` tool writes `assets/CREDITS.md` (the sounds, then every picture, clip, texture and model kept with a licence or made by a provider) and `assets/sounds/CREDITS.md` for the sounds.

An object a noun of the script stands for is made with `generate-image` and `object: true`: one subject on a flat ground, cut out with the matte of `remove-bg`, a transparent PNG (record `object: true, kept`: the share of the picture kept) placed whole at 60 % of the frame's shorter side, in the style of the kept style frame when the film plan has one. A cutout that kept under 3 % or over 92 % of the picture is kept for you to judge and reported as looking wrong.

## Tilts, the corner pin and the push-in

A layer's transform has two more properties, `rotationX` and `rotationY` (degrees, 0 by default: a document written before them renders exactly as before). They turn the layer around its horizontal or vertical axis through its anchor, seen from the composition camera's perspective (its `perspective`, 1000 px without a camera): a positive `rotationX` brings the bottom toward the viewer, a positive `rotationY` sends the right side away. A tilted layer, or a layer carrying `fx.pin`, is drawn alone as it would be flat, then carried onto its quad by one WebGL pass; a group is flattened into its picture first, so its children are warped together. At 90 degrees a layer is edge on and nothing shows; a layer with a corner at or behind the eye is not drawn. The checks read a tilted layer through its projected quad (its box, and its type as high as the quad's left edge), the viewport outlines it with its quad, and the Lottie and SVG exports draw it flat and say so.

`fx.pin` (the corner pin) carries the layer's box onto four corners in composition pixels (`tl`, `tr`, `br`, `bl`; all four equal means not set). The `pin` tool adds it: with `corners`, or with `onto`, another layer whose projected quad is sampled every tenth of a second and keyed on the four corners. The pin ignores the composition camera.

`push-in` keys the composition camera onto a layer: the zoom that makes it fill 0.6 of the frame (1.1 to 3), raised until its smallest text reads when it can be, the pan that centres it without the frame leaving the composition, held 1.2 s and, by default, back. A composition without a camera gets one at the defaults. A layer that is off the frame, hidden at that time or larger than the frame gets a text and no operation.

## Operations

Every change is a list of JSON Patch operations (RFC 6902) on JSON Pointer paths: `add`, `remove`, `replace`, `move`, `test`. For example, animating a layer's opacity:

```json
[{ "op": "add", "path": "/compositions/main/layers/title/transform/opacity",
   "value": { "$k": [{ "t": 0, "v": 0 }, { "t": 0.4, "v": 1, "ease": "@swift" }] } }]
```

`add` on an existing object key replaces it; on an array, it inserts at the index (`-` for the end). To add a layer: add `/compositions/<c>/layers/<id>`, then insert the id in `order` or in its group's `children`. To delete it: remove it from its array, then delete the entry (and its descendants). A batch is applied all or nothing, then validated; each batch is undone in one step.

## Interface pieces, finance charts and the comparison

The **interface** pack (`plugins/interface.js`) has ten nodes in a light and a dark palette, sized from their `width` on an 8 pt grid (`scale` 0.5 to 2): `ui.row`, `ui.plan`, `ui.cart`, `ui.ring`, `ui.bar`, `ui.badge`, `ui.toast`, `ui.toggle`, `ui.button`, `ui.table`. Each node's box hangs from its top edge, so a stack of them does not overlap. The `screen` tool reads the size of the screen that `device-screen` made (from its clip, never a copy of its code), stacks the pieces from the top with their entrances, sets the screen's colour for the theme and leaves out what does not fit, saying how many and the height they needed. `ui.cart` formats its amounts for its `locale` (the document holds no language); `ui.toast` carries ten Lucide glyphs of its own.

The **charts** pack (1.2) adds `chart.candles` (open, high, low, close, appearing left to right, the last close tagged) and `chart.price` (a line with a gradient under it, markers at named moments, the last value tagged), both on a scale that holds the lowest low and the highest high, never from zero. `chart.line` and `chart.price` now read plain numbers.

`compare` draws the render of a moment, a target (the kept style frame, an image asset or a project path) and their difference on one sheet, and scores the likeness 0 to 100 in palette (the main colours' distance in Lab), layout (the correlation of where each is busy, 16 × 9) and light (the overlap of the luma histograms), with up to three sentences on what differs most. A target of other proportions is fitted to cover and the text says so. The measure is in `@tramme/core` (`pictureDiff`, `likeness`), the one `tramme compare` uses.

## The critic and the takes

`critique` ("Review the film") has the film reviewed by a model that did not make it, in a fresh context: one request with no tools and no history, on the turn's own route (Opus 5.5 on the server and with the companion's Claude, the turn's model elsewhere; a local model without vision gets only the measures). It first measures what done means (`apps/editor/src/critic/done.ts`): material in every scene, a type hierarchy, no bare stretch over 20 s in a talking video, a hero, an ending, transitions, sound, nothing provisional, text readable. These are never overruled: the verdict is `done` only when none is missing and the critic says done. The critic sees the facts, the plan, the kept style frame and strips of four frames over 0.6 s around every cut, entrance, hero marker and coverage gap (12 at most, three to a picture), and answers strict JSON: a verdict, a score and at most three fixes. The setting *Critic rounds* (0 to 4, 2 by default, 0 turns it off) bounds the consults of one turn; the consults' tokens are counted apart in the turn's usage (`consults`) and `bench/usage.ts` prints them as a `critic` column.

`scene-takes` copies a scene that the critic named twice into `<comp>~take2` (and `~take3`), to be rebuilt differently; `critique { takes }` compares them in one consult, and `scene-takes { keep }` points the root at the kept composition and removes the others and the original.

## Scene by scene

The film plan's scenes carry `comp` (the composition the scene is built in, which the root plays), `brief` (what its builder needs beyond the plan: words, figures, sources, length) and `status` (`todo`, `built`, `failed`). The `scene-done` tool marks a scene built. When the director's turn writes a plan with three scenes or more to build and the setting *Scenes built apart* is on (the default), the turn stops at the root and each scene is built in its own turn: no history, the same system prompt (so its cached part is shared), a prompt with the brief, the plan and the neighbours' names only, and a scope that keeps its proposals to its composition and its takes (another composition, the root, and an existing asset or token are refused, the whole call with them). A scene that does not call `scene-done` is `failed` and the next one starts; a stop keeps what is built. A last turn, in the director's conversation, assembles: transitions, sound, `critique`, the summary. Each scene's turn ends with its own usage line (`scene`), shown under the scene's name in the Studio's notes and priced apart by `node bench/usage.ts`.

## The library of references

`references` reads, in words, what makes a frame or a cut work and the faults to avoid: about fifty principles and twenty-two faults in `apps/editor/data/references.json` (closed tags, no media, at most 900 characters each, copied by the build to `dist/references/catalogue.json` and loaded on first use). It searches by words (the same normalisation as the typeface search, `apps/editor/src/words.ts`) and, when nothing matches, gives the entries of the nearest tag and says so. It also reads the films the user kept and warns when the last five converge on one look (palette, typefaces, kinds of picture), ranking them lower. `reference-keep` writes the film of the project to the library shared by the projects as `reference-<project>.js`, with the reasons it works in words (at least 80 characters) and the facts read from the document; keeping it again replaces it. The critic's instructions carry the titles of the faults. The references stay out of the cached prompt: the assistant reads them through the tool, a few entries at a time.
