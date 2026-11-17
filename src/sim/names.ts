// Clan name generation. Prefix + "paw" for apprentices, prefix + warrior suffix for fighters, prefix + "star" for leaders.
import { Rng } from './core';

export const PREFIXES = [
  'Acorn', 'Adder', 'Alder', 'Amber', 'Apple', 'Ash', 'Aspen', 'Badger', 'Bark', 'Beech', 'Beetle', 'Berry', 'Birch', 'Black', 'Blossom',
  'Bracken', 'Bramble', 'Breeze', 'Briar', 'Bright', 'Brindle', 'Brook', 'Bumble', 'Burr', 'Buzzard', 'Cedar', 'Cherry', 'Cinder', 'Clover',
  'Copper', 'Crag', 'Creek', 'Crow', 'Daisy', 'Dapple', 'Dawn', 'Dew', 'Dove', 'Duck', 'Dun', 'Dusk', 'Eagle', 'Ember', 'Fallow', 'Fennel',
  'Fern', 'Finch', 'Flint', 'Flower', 'Fog', 'Frog', 'Frost', 'Gorse', 'Gravel', 'Hail', 'Hare', 'Hawk', 'Hazel', 'Heather', 'Holly', 'Hollow',
  'Honey', 'Ivy', 'Jay', 'Juniper', 'Kestrel', 'Lark', 'Larch', 'Leaf', 'Lichen', 'Lily', 'Lizard', 'Lynx', 'Maple', 'Marsh', 'Meadow',
  'Minnow', 'Mist', 'Moss', 'Moth', 'Mud', 'Nettle', 'Newt', 'Night', 'Oak', 'Otter', 'Owl', 'Pebble', 'Pine', 'Plum', 'Poppy', 'Quail',
  'Rabbit', 'Rain', 'Reed', 'Robin', 'Rook', 'Rowan', 'Rush', 'Rye', 'Sage', 'Sedge', 'Shade', 'Shrew', 'Slate', 'Sleet', 'Sloe', 'Snail',
  'Snow', 'Soot', 'Sorrel', 'Sparrow', 'Speckle', 'Spruce', 'Starling', 'Stoat', 'Stone', 'Storm', 'Swallow', 'Sweet', 'Sycamore', 'Tansy',
  'Teasel', 'Thistle', 'Thrush', 'Thyme', 'Toad', 'Torn', 'Vole', 'Wasp', 'Weasel', 'Wheat', 'Whisper', 'Willow', 'Wren', 'Yarrow',
];
export const SUFFIXES = [
  'pelt', 'fur', 'tail', 'claw', 'fang', 'whisker', 'heart', 'foot', 'stripe', 'leaf', 'wing', 'storm', 'flight', 'shade', 'nose', 'ear',
  'face', 'step', 'stream', 'pool', 'cloud', 'frost', 'fall', 'song', 'scar', 'pool', 'flower', 'thorn', 'blaze', 'shine', 'dapple', 'eye',
  'breeze', 'mist', 'spots', 'tuft', 'muzzle', 'jaw', 'belly', 'runner', 'watcher', 'patch', 'light', 'shadow', 'whisper', 'dawn', 'dusk',
];

/** Canon characters that must never be generated. */
export const BLOCKED = new Set([
  'firestar', 'fireheart', 'firepaw', 'graystripe', 'greystripe', 'ravenpaw', 'sandstorm', 'dustpelt', 'brackenfur', 'longtail', 'darkstripe',
  'tigerclaw', 'tigerstar', 'whitestorm', 'lionheart', 'spottedleaf', 'yellowfang', 'mousefur', 'runningwind', 'frostfur', 'brindleface',
  'goldenflower', 'willowpelt', 'cinderpelt', 'cinderpaw', 'swiftpaw', 'brightheart', 'cloudtail', 'thornclaw', 'ashfur', 'ferncloud',
  'bramblestar', 'brambleclaw', 'squirrelflight', 'leafpool', 'jayfeather', 'hollyleaf', 'lionblaze', 'bluestar', 'crookedstar', 'tallstar',
  'raggedstar', 'brokenstar', 'nightstar', 'leopardstar', 'mistystar', 'onestar', 'blackstar', 'mudclaw', 'deadfoot', 'crowfeather',
  'feathertail', 'stormfur', 'mothwing', 'mudfur', 'barkface', 'runningnose', 'oakheart', 'stonefur', 'mistyfoot', 'silverstream',
  'tawnypelt', 'russetfur', 'rowanclaw', 'littlecloud', 'boulder', 'jaggedtooth', 'clawface', 'blackfoot', 'webfoot', 'ashfoot', 'gorsepaw',
  'morningflower', 'tornear', 'whitetail', 'deadfoot', 'shrewpaw', 'redtail', 'sunstar', 'pinestar', 'thistleclaw', 'snowfur', 'speckletail',
  'smallear', 'patchpelt', 'oneeye', 'halftail', 'dappletail', 'dappleface', 'rosetail', 'mousewhisker', 'birchfall', 'ashpaw', 'fernpaw',
  'sorreltail', 'rainwhisker', 'sootfur', 'spiderleg', 'hazeltail', 'cherrytail', 'stormtail', 'sedgewhisker', 'dovewing', 'ivypool',
  'blossomfall', 'briarlight', 'bumblestripe', 'rosepetal', 'toadstep', 'icecloud', 'foxleap', 'poppyfrost', 'honeyfern', 'berrynose',
  'mousewhisker', 'cinderheart', 'hollypaw', 'birchpaw', 'whitewing', 'mintfur', 'reedwhisker', 'mosspelt', 'heavystep', 'hawkfrost',
  'mothflight', 'clearsky', 'grayswing', 'tallshadow', 'windrunner', 'riverripple', 'thunder', 'stoneteller', 'frostpaw', 'larkpaw',
]);

export function makeName(rng: Rng, kind: 'paw' | 'warrior' | 'star', taken: Set<string>): string {
  for (let tries = 0; tries < 60; tries++) {
    const p = rng.pick(PREFIXES);
    let s: string;
    if (kind === 'paw') s = 'paw';
    else if (kind === 'star') s = 'star';
    else s = rng.pick(SUFFIXES);
    if (s === p.toLowerCase()) continue;
    const name = p + s;
    const key = name.toLowerCase();
    if (BLOCKED.has(key)) continue;
    if (taken.has(key) && tries < 50) continue;
    taken.add(key);
    return name;
  }
  return 'Mousepaw';
}

/** Warrior name derived from an apprentice's prefix (used when a medicine cat apprentice or deputy is promoted). */
export function prefixOf(name: string): string {
  for (const suf of ['paw', 'star', ...SUFFIXES]) if (name.endsWith(suf)) return name.slice(0, name.length - suf.length);
  return name;
}

/** Proposed canon leaders (see spec section 13; lore needs verifying). */
export const CANON_LEADERS: Record<string, string> = { thunder: 'Bluestar', river: 'Crookedstar', wind: 'Tallstar', shadow: 'Raggedstar' };

export const DEATH_LINES = ['hunts with StarClan', 'walks with StarClan now', 'has gone to StarClan', 'joins the ranks of StarClan'];
