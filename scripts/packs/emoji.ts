// The emoji pack's data, converted once from Microsoft's Fluent Emoji (MIT):
// the 300 most used as flat SVG beside the pack (plugins/emoji/), with an
// index of names, keywords and codepoints. The selection list is fixed here,
// in usage order; a name the set does not have is skipped for the next one.
//
//   node scripts/packs/emoji.ts            # write plugins/emoji/
//
// Sources: the set's git tree (for the folder of each emoji), Unicode's
// emoji-test.txt (public domain, for each name's codepoint). Run again to
// refresh from a newer set; the list decides what ships, not the set.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const OUT = join(import.meta.dirname, '../../plugins/emoji');
const TREE = 'https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1';
const RAW = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/';
const EMOJI_TEST = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';
const COUNT = 300;

/** the 300 most used, in order (a few names carry an alias when the set names them differently) */
const RANKED = `smiling face with smiling eyes
grinning face with big eyes
face blowing a kiss
smiling face with hearts
face with tears of joy
loudly crying face
red heart
sparkles
fire
thumbs up
heart on fire
heart hands
smiling face with tear
pleading face
star-struck
heart suit
wrapped gift
party popper
partying face
clinking glasses
smiling face with heart-eyes
face savoring food
waving hand
raising hands
clapping hands
folded hands
handshake
flexed biceps
ok hand
crossed fingers
love letter
kiss mark
two hearts
revolving hearts
growing heart
sparkling heart
broken heart
mending heart
crying face
smirking face
unamused face
face with rolling eyes
thinking face
shushing face
face with hand over mouth
lying face
melting face
saluting face
downcast face with sweat
face exhaling
weary face
tired face
sleeping face
drooling face
face vomiting
nauseated face
face with steam from nose
angry face
pouting face
face with symbols on mouth
smiling face with horns
clown face
zany face
grimacing face
face with open mouth
astonished face
flushed face
anguished face
fearful face
anxious face with sweat
sad but relieved face
confounded face
confused face
upside-down face
money-mouth face
nerd face
face with monocle
cowboy hat face
disguised face
smiling face with sunglasses
cold face
hot face
baby
princess
angry face with horns
ghost
alien monster
robot
pile of poo
hundred points symbol
check mark button
cross mark button
exclamation question mark
red question mark
white question mark
red exclamation mark
white exclamation mark
key
locked
locked with pen
light bulb
candle
flashlight
red paper lantern
notebook
ledger
page facing up
scroll
memo
pencil
pen
paintbrush
crayon
camera
video camera
movie camera
clapper board
television
radio
microphone
studio microphone
headphone
musical note
musical notes
laptop
desktop computer
printer
keyboard
computer mouse
trackball
floppy disk
mobile phone
telephone receiver
pager
fax machine
battery
electric plug
calendar
spiral calendar
tear-off calendar
alarm clock
hourglass done
hourglass not done
watch
stopwatch
timer clock
mantelpiece clock
speech balloon
left speech bubble
thought balloon
eyes
eye
billed cap
graduation cap
top hat
crown
lipstick
ring
gem stone
high-heeled shoe
running shoe
t-shirt
jeans
necktie
dress
bikini
coat
gloves
scarf
socks
umbrella
sun
full moon face
crescent moon
star
glowing star
shooting star
cloud
sun behind cloud
cloud with rain
tornado
fog
wind face
snowflake
high voltage
droplet
sweat droplets
water wave
rainbow
beach with umbrella
national park
volcano
mount fuji
mountain
world map
compass
statue of liberty
fountain
house
house with garden
office building
bank
hospital
convenience store
school
factory
castle
wedding
brick
tent
airplane
rocket
flying saucer
helicopter
ship
sailboat
speedboat
anchor
train
bullet train
bus
ambulance
fire engine
police car
taxi
automobile
delivery truck
tractor
bicycle
kick scooter
motor scooter
construction
soccer ball
basketball
american football
tennis
volleyball
rugby football
pool 8 ball
ping pong
badminton
boxing glove
martial arts uniform
goal net
ice skate
fishing pole
trophy
1st place medal
2nd place medal
3rd place medal
sports medal
military medal
reminder ribbon
ticket
admission tickets
circus tent
framed picture
confetti ball
balloon
dango
drum
yo-yo
kite
crystal ball
nazar amulet
video game
joystick
game die
puzzle piece
teddy bear
bowling
performing arts
artist palette
thread
yarn
money bag
coin
dollar banknote
yen banknote
euro banknote
pound banknote
money with wings
credit card
receipt
chart increasing
chart decreasing
bar chart
clipboard
pushpin
round pushpin
paperclip
straight ruler
triangular ruler
scissors
card index dividers
file folder
open file folder
wastebasket
locked with key
old key
hammer
axe
pick
hammer and pick
hammer and wrench
dagger
syringe
drop of blood
adhesive bandage
stethoscope
pill
test tube
petri dish
microscope
telescope
satellite antenna
soap
broom
bucket
fire extinguisher
seedling
potted plant
evergreen tree
deciduous tree
palm tree
cactus
sheaf of rice
herb
four leaf clover
maple leaf
fallen leaf
leaf fluttering in wind
mushroom
chestnut
bouquet
cherry blossom
rose
hibiscus
sunflower
tulip
blossom
lotus
dog face
cat face
mouse face
hamster
rabbit face
fox
bear
panda
tiger face
lion
cow face
pig face
frog
monkey face
see-no-evil monkey
chicken
rooster
hatching chick
baby chick
bird
penguin
eagle
duck
swan
owl
flamingo
peacock
turkey
turtle
snake
lizard
dragon
spouting whale
dolphin
fish
tropical fish
blowfish
shark
octopus
spiral shell
snail
butterfly
bug
ant
honeybee
beetle
cricket
spider
scorpion
mosquito
microbe
red apple
green apple
pear
tangerine
lemon
banana
watermelon
grapes
strawberry
blueberries
cherries
peach
mango
pineapple
coconut
kiwi fruit
tomato
eggplant
avocado
carrot
ear of corn
hot pepper
cucumber
leafy green
broccoli
garlic
onion
peanuts
bread
croissant
baguette bread
pretzel
bagel
pancakes
waffle
cheese wedge
meat on bone
poultry leg
cut of meat
bacon
hamburger
french fries
pizza
hot dog
sandwich
taco
burrito
stuffed flatbread
falafel
egg
cooking
pot of food
bowl with spoon
green salad
popcorn
butter
salt
canned food
bento box
rice cracker
rice ball
cooked rice
curry rice
steaming bowl
spaghetti
roasted sweet potato
oden
sushi
fried shrimp
moon cake
dumpling
fortune cookie
takeout box
soft ice cream
shaved ice
ice cream
doughnut
cookie
birthday cake
shortcake
cupcake
pie
chocolate bar
candy
lollipop
custard
honey pot
baby bottle
glass of milk
coffee
hot beverage
sake
wine glass
cocktail glass
tropical drink
beer mug
clinking beer mugs
tumbler glass
cup with straw
bubble tea
beverage box
ice
chopsticks
fork and knife with plate
fork and knife
spoon
person raising hand
person
woman
man
older person
teacher
student
technologist
office worker
mechanic
scientist
artist
singer
health worker
police officer
firefighter
judge
person in lotus position
person lifting weights
person biking
person swimming
person running
person walking
family
couple with heart
kiss
people holding hands
ear
nose
tongue
mouth
brain
bust in silhouette
leg
foot
tooth
bone
ear with hearing aid
oncoming bus
jack-o-lantern
christmas tree
santa claus
firecracker
fireworks
red envelope
mirror ball
gift heart
diamond with a dot
bell
bell with slash
megaphone
loudspeaker
musical keyboard
guitar
violin
trumpet
saxophone
banjo
envelope
envelope with arrow
e-mail
inbox tray
outbox tray
package
postal horn
round pushpin
new button
cool button
free button
up button
direct hit
shopping cart
backpack
handbag
screwdriver
wrench
gear
clamp
boomerang
sparkler
teapot
amphora
open book
closed book
green book
blue book
orange book
books
bookmark
bookmark tabs
label
card file box
file cabinet
couch and lamp
chair
toilet
shower
bathtub
bed
door
elevator
classical building
stadium
crutch
x-ray
abacus
safety pin
basket
roll of paper
bar of soap
cigarette
coffin
funeral urn
moai
oil drum
shield
long drum
knife
earth globe europe-africa
earth globe americas
earth globe asia-australia
globe with meridians
ringed planet
milky way
comet
new moon face
first quarter moon face
last quarter moon face
sun with face
wind chime
sunset
sunrise
cityscape
night with stars
sunset over buildings
bridge at night
hot springs
carousel horse
ferris wheel
roller coaster
barber pole
steam locomotive
railway car
station
tram
monorail
mountain railway
metro
small airplane
airplane departure
airplane arrival
parachute
seat
canoe
passenger ship
ferry
motor boat`
  .split('\n').map((s) => s.trim()).filter(Boolean);

const kebab = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Entry { name: string; file: string; codepoint?: string; keywords: string[] }

const tree: { tree: { path: string }[] } = await (await fetch(TREE)).json();
// each emoji's flat SVG: beside the folder when it has no variants, under Default when it has some
const svgOf = new Map<string, string>();
for (const t of tree.tree) {
  const p = t.path;
  if (!p.endsWith('.svg') || !p.includes('/Flat/')) continue;
  const name = p.split('/')[1].toLowerCase();
  const plain = p === `assets/${p.split('/')[1]}/Flat/${kebab(p.split('/')[1])}_flat.svg`;
  const better = plain || !svgOf.has(name);
  if (better && (plain || p.includes('/Default/'))) svgOf.set(name, p);
}
// the codepoints, from Unicode's own data (public domain)
const codepoints = new Map<string, string>();
const test = await (await fetch(EMOJI_TEST)).text();
for (const line of test.split('\n')) {
  const m = /^([0-9A-F][0-9A-F ]*)\s*;\s*fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/.exec(line);
  if (m) codepoints.set(m[3].trim().toLowerCase(), m[1].trim().replace(/\s+/g, ' '));
}

const out: Entry[] = [];
const seen = new Set<string>();
for (const name of RANKED) {
  if (out.length >= COUNT) break;
  if (seen.has(name)) continue;
  seen.add(name);
  const path = svgOf.get(name);
  if (!path) { console.error(`skipped (not in the set): ${name}`); continue; }
  out.push({ name, file: `${kebab(name)}.svg`, codepoint: codepoints.get(name), keywords: name.split(/\s+/).filter((w) => w.length > 1) });
}

mkdirSync(OUT, { recursive: true });
let done = 0;
for (let i = 0; i < out.length; i += 16) {
  const batch = out.slice(i, i + 16);
  await Promise.all(batch.map(async (e) => {
    const res = await fetch(RAW + svgOf.get(e.name));
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${e.name}`);
    writeFileSync(join(OUT, e.file), await res.text());
    done++;
  }));
  process.stdout.write(`\r${done}/${out.length}`);
}
process.stdout.write('\n');
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ source: 'fluent-emoji-flat', licence: 'MIT', version: '2026.2', count: out.length, emoji: out }));
console.log(`fluent emoji: ${out.length} written, ${RANKED.length - seen.size} unused -> ${OUT}`);
void dirname;
