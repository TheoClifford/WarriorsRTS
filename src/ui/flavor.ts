// Text barks and taunts, in the Clans' own idiom.
export const BARKS: Record<string, string[]> = {
  select: ['Yes?', 'Ready.', 'I\'m listening.', 'What is it?', 'Say the word.', 'My claws are yours.'],
  selectApp: ['Yes?', 'Is it time to hunt?', 'I\'m ready!', 'Do I have to check the elders for ticks?', 'What should I do?'],
  selectLeader: ['Speak.', 'StarClan walks with us.', 'The Clan comes first.', 'What does the Clan need?'],
  selectMed: ['Yes?', 'Is someone hurt?', 'StarClan sends signs.', 'Keep still while I look.'],
  move: ['On my way.', 'Right away.', 'Following the scent.', 'As quick as a rabbit.', 'Moving.'],
  attack: ['Claws out!', 'For the Clan!', 'They\'ll regret this.', 'Mouse-brain! Get off our land!', 'Fox-hearts!'],
  gather: ['I\'ll fetch it.', 'Hunting!', 'I\'ll be as quiet as a shadow.', 'Fresh-kill for the Clan.'],
  moss: ['Moss for the nests.', 'I\'ll gather some.', 'The elders will be pleased.'],
  herbs: ['Herbs, careful now.', 'Marigold, not mouse bile.', 'I know where it grows.'],
  build: ['Bramble by bramble.', 'I\'ll weave it.', 'It\'ll keep the rain out.'],
  heal: ['Stay still, this will sting.', 'Cobwebs, quickly.'],
  deputy: ['I will serve my Clan.', 'I\'ll do my best.'],
};
export function clanBark(clan: string): string {
  const n: Record<string, string> = { thunder: 'ThunderClan', river: 'RiverClan', wind: 'WindClan', shadow: 'ShadowClan' };
  return 'For ' + (n[clan] || 'the Clan') + '!';
}
export const TAUNTS: Record<number, string> = {
  1: 'Yes.', 2: 'No.', 3: 'Need prey.', 4: 'Need moss.', 5: 'Need herbs.', 6: 'Mouse-brain!', 7: 'Fox-dung!', 8: 'Great StarClan!',
  9: 'Get off our territory!', 10: 'This is our land now.', 11: '*purrs*', 12: 'Your warriors are as slow as slugs.',
  13: 'Is that a patrol or a kittypet picnic?', 14: 'You fight like a newborn kit.', 15: 'StarClan has turned its back on you.',
  16: 'Run back to your nest.', 17: 'Hedgehogs fly before you take our camp.', 18: 'Truce for the Gathering?', 19: 'Never!', 20: 'Good hunting.',
};
