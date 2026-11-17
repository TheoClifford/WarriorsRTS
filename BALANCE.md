# Balance pass

The spec (section 11) asks for AI round robins of thousands of games with these targets:
each Clan wins 45–55%, no build order wins more than 60%, median game 15–25 min,
Border Moons around 4:30–5:30, Battle Moons around 11–13 min.

Every pass is a full factorial: every ordered pair of Clans × every pair of build orders
(balanced, rush, boom) × N seeds, normal-difficulty AI on both sides, 35-minute cap.
Win rates count decided games only, with Wilson 95% intervals.

## Results

| | Pass 1 (before) | Pass 2 | Final |
|---|---|---|---|
| Games | 1,080 | 2,160 | 2,160 |
| ThunderClan | 51.5% | 53.4% | 54.1% |
| RiverClan | **60.0%** | 46.7% | 45.3% |
| WindClan | 51.2% | **41.4%** | 50.8% |
| ShadowClan | **37.0%** | **58.5%** | 49.7% |
| Balanced | 52.9% | 44.0% | 47.0% |
| Rush | **22.4%** | 50.4% | 50.9% |
| Boom | **75.3%** | 55.7% | 52.1% |
| Median length | 25.1 min | 21.8 min | 22.0 min |
| Border Moons (median) | 5.2 min | 5.4 min | 5.4 min |
| Battle Moons (median) | 11.2 min | 12.2 min | 12.2 min |

Bold = outside target. The final pass used fresh seeds that no tuning step had seen.
RiverClan's point estimate is inside the band but its interval (42–48%) dips below it, and
ThunderClan beats RiverClan 59% head to head, the most lopsided pairing left.
Build orders now go round in a loose circle: boom beats balanced 57%, rush beats boom 53%,
balanced and rush are even. Full reports: `test/out/*.report.txt`.

## What was wrong, and what changed

**Herb units were bad value.** An equal-cost arena (`test/arena.ts`) showed Warriors beating
Runners and Stalkers by ~75 points, and Guards beating Stalkers, the unit meant to counter them.
Clans with more herbs fielded more of the weak units, which is most of why ThunderClan
(fewest herbs, most Warriors) was quietly strong.

| Unit | Before | After |
|---|---|---|
| Warrior | 60 prey, 60 HP | 60 prey, 55 HP |
| Runner | 70 prey + 15 herbs | 50 prey + 8 herbs |
| Stalker | 45 prey + 25 herbs, 35 HP, +5 vs Guards | 35 prey + 12 herbs, 45 HP, +7 vs Guards |
| Moor Runner (Wind) | 75 prey + 15 herbs | 50 prey + 8 herbs (same as a Runner, faster) |
| Ambusher (Thunder) | 55 prey + 30 herbs, 45 HP | 40 prey + 12 herbs, 50 HP, +7 vs Guards |
| Shadow Warrior | 65 prey + 10 herbs, 60 HP, 7 dmg | 60 prey + 5 herbs, 65 HP, 8 dmg |

After: Guards beat Runners, Runners beat Stalkers, Stalkers beat Guards (each by 50–77 points
at equal cost), Warriors are within about ±30 of every common unit, and the Battle Moons Clan
units are a step up, as they should be.

**Defenders were too strong, so whoever attacked first lost.** That made boom (attack last)
win 75% and rush 22%.

- Leader: 200 → 160 HP, 12 → 10 damage, armour 2 → 1, +25% → +20% per age. It was killing
  five or six raiding Warriors per life.
- Camp thorns: 3 → 2.5 damage/s, +0.5 → +0.35 per sheltered apprentice. Nursery queens 3 → 2.
- Home-ground damage bonus 10% → 6% (Border Patrols 15% → 12%).

**Sim bug: cats clawing at a den ignored the enemy killing them.** Fighters on attack-move now
drop a building for an enemy cat in reach, and a cat hit while attacking a building turns on
its attacker (an explicit attack order on the building still holds).

**Clans.**

- ThunderClan: moving concealment only on their own home ground; undergrowth slows them like
  everyone else again; Mentors 20% → 10%.
- WindClan: Lean 10% → 5% less HP; moor hunting +15% → +18%; Moor Runner cost (above).
- ShadowClan: hunting +10% → +15%; Shadow Warrior (above). The weakness text now says what
  it is: the least prey at home of any Clan.
- RiverClan: fishing 0.6 → 0.66 prey/s, to make up for the weaker camp and queens.

**AI.** The balance numbers are only as good as the scripts playing them.

- Rush is a real rush now: moss first, two hollows on about 12 apprentices, Warriors before the
  Border Moons, raid with 8 at about 4:00, keep raiders out of the camp's thorns, then grow to
  30 apprentices behind the raids. It used to age up first and attack at 6:30 with 6.
- Attacks muster at a staging point 60% of the way and go in once three quarters of the
  patrol has arrived (45 s cap), instead of arriving strung out by speed.
- Apprentices leave adders and rats before they die. They were losing about eight ThunderClan
  apprentices a game at Snakerocks.
- The AI withdraws from a lost game (no fighters, 8 or fewer apprentices, no prey, five or more
  enemies at the camp for a minute, after 10 minutes) instead of making the winner grind the
  camp down. Not on Easy.

## Speed

Optimised before the pass so thousands of games are cheap, and checked against recorded
state hashes (`test/golden.ts`) so the speed-ups changed no behaviour.

- Simulation: 2.7× faster (0.16 → about 0.07 ms per tick with two AIs). Typed-array spatial grid,
  cached field-of-view rays, cached building vision, cached drop-off lists, path cache, a
  flat-array A* heap, and every unit created with the same field layout so V8 keeps one shape.
- Terrain: chunks paint 1.75× faster, pixel-identical, and now paint in slices within 5 ms a frame
  instead of stalling when the camera jumps.
- Sprites: the ray tracer is 1.25× faster with no allocation per pixel, pixel-identical.
- Fog is rebuilt only when vision changes, the minimap redraws at 10 fps from a cached layer,
  map props are bucketed by screen row, and draw records are pooled.
- The harness plays a 2,160-game round robin in about 19 minutes on two cores, roughly a
  second per 22-minute game.

## Rerunning

```
test/runbal.sh <seeds> test/out/name.jsonl [seedBase]   # 108 games per seed, 2 processes, prints report
python3 test/stratstats.py test/out/name.jsonl          # per build-order pairing: prey, kills, army, Age II
test/ab.sh <clan> <seeds> <seedBase> '<json patch>'     # one Clan's win rate under a balance.json patch
node /tmp/arena.mjs <unit,unit,...> '<json patch>'      # equal-cost unit arena (build test/arena.ts first)
node /tmp/trace.mjs <clan> <clan> <order> <order> <seed> <sec>   # one game, a line per interval
```

The harness resumes a half-finished output file. A 2,160-game pass takes about 22 minutes on two cores.
